(function() {
    const KAKAO_API_KEY = "00a03dac8488d12731e4021756938e72";   // Your real key from HTML
    const ORS_API_KEY = "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6IjBjMGUyMGY3YmM4NzQwNWY5ZDUyYzE4Y2VkMjI1Mjc1IiwiaCI6Im11cm11cjY0In0=";

    // ==================== NEW VARIABLES FOR TRACE ====================
    let traveledPath = [];           // Stores all previous positions
    let traveledPolyline = null;     // The thin trace line
    let totalDistanceTraveled = 0;   // in meters
    let lastTracePosition = null;

    // Original variables
    let destinationLocation = null;
    const gentleAnimationDistance = 1500;
    const veryFastAnimationDistance = 700;
    const arrivalDistance = 100;
    const maxMarkerSize = 28;
    const baseMarkerSize = 18;                    // Smaller duck
    const destinationSizeMultiplier = 0.8;
    const gentleMarkerMultiplier = 1.6;
    const energeticMarkerMultiplier = 2;
    const centerOnDestinationThreshold = 150;
    const HIGH_ACCURACY_THRESHOLD_METERS = 500;
    const OFF_ROUTE_THRESHOLD_METERS = 150;
    const MIN_MOVEMENT_THRESHOLD_METERS = 5;
    const QUACK_ACTIVATION_DISTANCE = 200;

    let map = null;
    let startLocation = null;
    let lastKnownPosition = null;
    let startOverlay = null;
    let destinationOverlay = null;
    let currentPolyline = null;
    let fullPolylinePath = null;
    let locationWatchId = null;
    let quackIntervalId = null;
    let quackDirection = 'left';
    let isMapInitialized = false;
    let isHighAccuracyMode = false;
    let isIdleMode = false;
    let lastSignificantMovementTime = Date.now();
    const IDLE_DETECTION_INTERVAL_MS = 10000;
    const IDLE_DURATION_THRESHOLD_MS = 30000;
    let idleCheckTimer = null;
    let routeIsFetched = false;
    let fullRouteDuration = 0;
    let fullRouteDistance = 0;
    let timerContainerElement = null;
    let duckImageElement = null;
    let duckMarkerContainer = null;
    let destinationMarkerContainer = null;

    const duckImageSrc = 'duck.png';
    const gentleDestinationImageSrc = 'd.gif';
    const energeticDestinationImageSrc = 'f.gif';

    function throttle(func, limit) {
        let inThrottle;
        return function() {
            const args = arguments;
            const context = this;
            if (!inThrottle) {
                func.apply(context, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }

    async function retryFetch(url, options, retries = 3, delay = 1000) {
        try {
            const response = await fetch(url, options);
            if (!response.ok) {
                if (response.status === 429 || (response.status >= 500 && retries > 0)) {
                    await new Promise(res => setTimeout(res, delay));
                    return retryFetch(url, options, retries - 1, delay * 2);
                }
                throw response;
            }
            return response;
        } catch (error) {
            if (retries > 0) {
                await new Promise(res => setTimeout(res, delay));
                return retryFetch(url, options, retries - 1, delay * 2);
            }
            throw error;
        }
    }

    // ==================== NEW: UPDATE TRAVELED TRACE ====================
    function updateTraveledTrace(newPosition) {
        if (!map || !newPosition) return;

        const newLatLng = new kakao.maps.LatLng(newPosition[0], newPosition[1]);
        traveledPath.push(newLatLng);

        if (traveledPolyline) {
            traveledPolyline.setPath(traveledPath);
        } else {
            traveledPolyline = new kakao.maps.Polyline({
                map: map,
                path: traveledPath,
                strokeWeight: 3.5,
                strokeColor: '#4B5563',     // Nice gray
                strokeOpacity: 0.75,
                strokeStyle: 'solid'
            });
        }

        // Calculate distance
        if (lastTracePosition) {
            const segment = calculateDistance(lastTracePosition, newPosition);
            totalDistanceTraveled += segment;
        }
        lastTracePosition = newPosition;

        updateTraveledDistanceDisplay();
    }

    function updateTraveledDistanceDisplay() {
        const kmTraveled = (totalDistanceTraveled / 1000).toFixed(2);

        if (timerContainerElement) {
            timerContainerElement.innerHTML = `
                <span style="font-size: 1.1rem; font-weight: 700;">${kmTraveled} km</span>
                <div style="font-size: 0.75rem; opacity: 0.75; margin-top: 2px;">Traveled</div>
            `;
        }
    }

    function updateAllMarkerSizes(level, remainingTravelDistance) {
        if (!startOverlay || !duckImageElement) return;

        const duckScale = Math.min(Math.max(baseMarkerSize, baseMarkerSize * (level / 2)), maxMarkerSize);
        duckImageElement.style.width = `${duckScale}px`;
        duckImageElement.style.height = `${duckScale}px`;

        if (destinationMarkerContainer) {
            let destinationScale = duckScale * destinationSizeMultiplier;
            if (remainingTravelDistance < gentleAnimationDistance) destinationScale = duckScale * gentleMarkerMultiplier;
            else if (remainingTravelDistance < veryFastAnimationDistance) destinationScale = duckScale * energeticMarkerMultiplier;

            destinationMarkerContainer.style.width = `${destinationScale}px`;
            destinationMarkerContainer.style.height = `${destinationScale}px`;
        }
    }

    function updateDestinationMarkerState(state, duckScale) {
        if (!isMapInitialized || !destinationLocation) return;

        let content = '';
        let imgSrc = '';
        let destinationScale = duckScale * destinationSizeMultiplier;

        if (state === 'very-fast' || state === 'arrived') {
            destinationScale = duckScale * energeticMarkerMultiplier;
            imgSrc = energeticDestinationImageSrc;
        } else if (state === 'gentle') {
            destinationScale = duckScale * gentleMarkerMultiplier;
            imgSrc = gentleDestinationImageSrc;
        }

        if (imgSrc) {
            content = `<div id="destination-marker-container" style="width: ${destinationScale}px; height: ${destinationScale}px;">
                        <img src="${imgSrc}" alt="Destination" class="destination-image">
                       </div>`;
        } else {
            content = `<div id="destination-marker-container" style="width: ${destinationScale}px; height: ${destinationScale}px;">
                        <svg class="classic-marker-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5s2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                        </svg>
                       </div>`;
        }

        if (destinationOverlay) {
            destinationOverlay.setContent(content);
        } else if (destinationLocation) {
            destinationOverlay = new kakao.maps.CustomOverlay({
                map: map,
                position: new kakao.maps.LatLng(destinationLocation[0], destinationLocation[1]),
                content: content,
                yAnchor: 1,
                zIndex: 1
            });
        }
        destinationMarkerContainer = document.getElementById('destination-marker-container');
    }

    function setStartMarker() {
        if (!isMapInitialized || !startLocation) return;

        const currentLevel = map.getLevel();
        const scale = Math.min(Math.max(baseMarkerSize, baseMarkerSize * (currentLevel / 2)), maxMarkerSize);

        const content = `<div id="duck-marker-container" style="position: relative; width: ${scale}px; height: ${scale}px; transform-origin: center bottom;">
                            <img id="duck-image" src="${duckImageSrc}" alt="You" class="wiggle-duck" style="width: 100%; height: 100%;">
                         </div>`;

        if (startOverlay) {
            startOverlay.setPosition(new kakao.maps.LatLng(startLocation[0], startLocation[1]));
        } else {
            startOverlay = new kakao.maps.CustomOverlay({
                map: map,
                position: new kakao.maps.LatLng(startLocation[0], startLocation[1]),
                content: content,
                yAnchor: 1,
                zIndex: 2
            });
            duckMarkerContainer = document.getElementById('duck-marker-container');
            duckImageElement = document.getElementById('duck-image');
        }
    }

    function createQuack() { /* ... keep your original quack function ... */ 
        if (!duckMarkerContainer) return;
        const quack = document.createElement('div');
        const colors = ['#FFD700', '#FFB6C1', '#87CEFA', '#98FB98', '#FFA07A'];
        const text = "quack !";
        let colorIndex = 0;
        let content = '';
        for (const char of text) {
            content += `<span style="color: ${colors[colorIndex % colors.length]}">${char}</span>`;
            colorIndex++;
        }
        quack.innerHTML = content;
        quack.classList.add('quack-text');

        quack.classList.add(quackDirection === 'left' ? 'quack-right' : 'quack-left');
        quackDirection = quackDirection === 'left' ? 'right' : 'left';

        duckMarkerContainer.appendChild(quack);
        setTimeout(() => quack.remove(), 500);
    }

    function startQuacking() {
        if (quackIntervalId) return;
        quackIntervalId = setInterval(createQuack, 500);
    }

    function stopQuacking() {
        if (quackIntervalId) clearInterval(quackIntervalId);
        quackIntervalId = null;
        if (duckMarkerContainer) {
            document.querySelectorAll('.quack-text').forEach(q => q.remove());
        }
    }

    function init() {
        timerContainerElement = document.getElementById('timer-container');
        timerContainerElement.style.display = 'block';

        const mapContainer = document.getElementById('map');

        const mapOption = {
            center: new kakao.maps.LatLng(37.5665, 126.9780),
            level: 7,                    // Larger view (city level)
            draggable: false,
            scrollwheel: false,
            disableDoubleClick: true,
            disableDoubleClickZoom: true
        };

        map = new kakao.maps.Map(mapContainer, mapOption);
        isMapInitialized = true;

        // Start tracking user's location immediately
        startLocationTracking();
    }

    // ==================== MAIN TRACKING FUNCTION ====================
    function startLocationTracking() {
        if (locationWatchId) navigator.geolocation.clearWatch(locationWatchId);

        const watchOptions = {
            enableHighAccuracy: true,
            timeout: 5000,
            maximumAge: 0
        };

        locationWatchId = navigator.geolocation.watchPosition(
            function(position) {
                const newPosition = [position.coords.latitude, position.coords.longitude];

                if (!lastKnownPosition || calculateDistance(lastKnownPosition, newPosition) > MIN_MOVEMENT_THRESHOLD_METERS) {
                    lastSignificantMovementTime = Date.now();
                    lastKnownPosition = newPosition;
                    startLocation = newPosition;

                    // Update trace and distance
                    updateTraveledTrace(newPosition);

                    setStartMarker();
                    map.setCenter(new kakao.maps.LatLng(newPosition[0], newPosition[1]));
                    map.setLevel(6); 
                }
            },
            function(error) {
                console.error("Location error:", error);
                let msg = "GPS error";
                if (error.code === error.PERMISSION_DENIED) msg = "🚫 Enable location";
                if (timerContainerElement) timerContainerElement.innerHTML = msg;
            },
            watchOptions
        );
    }

    function calculateDistance(coord1, coord2) {
        const toRad = x => x * Math.PI / 180;
        const R = 6371e3;

        const dLat = toRad(coord2[0] - coord1[0]);
        const dLng = toRad(coord2[1] - coord1[1]);

        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(toRad(coord1[0])) * Math.cos(toRad(coord2[0])) *
                  Math.sin(dLng / 2) * Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return R * c;
    }

    // Load Kakao Maps and start
    if (typeof kakao !== 'undefined' && kakao.maps) {
        kakao.maps.load(function() {
            try {
                init();
            } catch (e) {
                console.error("Map init error:", e);
                document.getElementById('map').innerHTML = '<div class="error-message">Failed to load map</div>';
            }
        });
    }
})();
