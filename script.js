(function() {
    const KAKAO_API_KEY = "00a03dac8488d12731e4021756938e72";
    const ORS_API_KEY = "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6IjBjMGUyMGY3YmM4NzQwNWY5ZDUyYzE4Y2VkMjI1Mjc1IiwiaCI6Im11cm11cjY0In0=";

    // Trace variables
    let traveledPath = [];
    let traveledPolyline = null;
    let totalDistanceTraveled = 0;
    let lastTracePosition = null;

    // Main variables
    let map = null;
    let startLocation = null;
    let lastKnownPosition = null;
    let startOverlay = null;
    let locationWatchId = null;
    let quackIntervalId = null;
    let quackDirection = 'left';
    let isMapInitialized = false;
    let lastSignificantMovementTime = Date.now();

    const baseMarkerSize = 17;           // Small duck icon
    const maxMarkerSize = 26;
    const MIN_MOVEMENT_THRESHOLD_METERS = 5;

    const duckImageSrc = 'duck.png';

    let timerContainerElement = null;
    let duckImageElement = null;
    let duckMarkerContainer = null;

    function throttle(func, limit) {
        let inThrottle;
        return function() {
            if (!inThrottle) {
                func.apply(this, arguments);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }

    // ==================== TRAVELED DISTANCE DISPLAY ====================
    function updateTraveledDistanceDisplay() {
        const kmTraveled = (totalDistanceTraveled / 1000).toFixed(2);
        
        if (timerContainerElement) {
            timerContainerElement.innerHTML = `
                <span style="font-size: 0.95rem; font-weight: 700; color: rgba(0,0,0,0.85);">
                    ${kmTraveled} km
                </span>
            `;
        }
    }

    // ==================== UPDATE TRAVELED TRACE ====================
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
                strokeWeight: 3,
                strokeColor: '#374151',
                strokeOpacity: 0.65,
                strokeStyle: 'solid'
            });
        }

        if (lastTracePosition) {
            totalDistanceTraveled += calculateDistance(lastTracePosition, newPosition);
        }
        lastTracePosition = newPosition;

        updateTraveledDistanceDisplay();
    }

    function setStartMarker() {
        if (!isMapInitialized || !startLocation) return;

        const currentLevel = map.getLevel();
        const scale = Math.min(Math.max(baseMarkerSize, baseMarkerSize * (currentLevel / 2)), maxMarkerSize);

        const content = `<div id="duck-marker-container" style="width: ${scale}px; height: ${scale}px;">
                            <img id="duck-image" src="${duckImageSrc}" alt="You" style="width: 100%; height: 100%;">
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

    function createQuack() {
        if (!duckMarkerContainer) return;
        const quack = document.createElement('div');
        const colors = ['#FFD700', '#87CEFA', '#98FB98'];
        const text = "quack!";
        let content = '';
        let i = 0;
        for (const char of text) {
            content += `<span style="color:${colors[i % colors.length]}">${char}</span>`;
            i++;
        }
        quack.innerHTML = content;
        quack.classList.add('quack-text');
        quack.classList.add(quackDirection === 'left' ? 'quack-right' : 'quack-left');
        quackDirection = quackDirection === 'left' ? 'right' : 'left';

        duckMarkerContainer.appendChild(quack);
        setTimeout(() => quack.remove(), 600);
    }

    function startQuacking() {
        if (quackIntervalId) return;
        quackIntervalId = setInterval(createQuack, 450);
    }

    function calculateDistance(coord1, coord2) {
        const toRad = x => x * Math.PI / 180;
        const R = 6371e3;
        const dLat = toRad(coord2[0] - coord1[0]);
        const dLng = toRad(coord2[1] - coord1[1]);
        const a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(toRad(coord1[0]))*Math.cos(toRad(coord2[0]))*Math.sin(dLng/2)*Math.sin(dLng/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    function init() {
        timerContainerElement = document.getElementById('timer-container');
        
        // Make timer transparent with no background
        timerContainerElement.style.backgroundColor = 'transparent';
        timerContainerElement.style.boxShadow = 'none';
        timerContainerElement.style.padding = '4px 10px';
        timerContainerElement.style.fontSize = '0.95rem';

        const mapContainer = document.getElementById('map');

        const mapOption = {
            center: new kakao.maps.LatLng(37.5665, 126.9780),
            level: 7,                    // City-level view
            draggable: false,
            scrollwheel: false,
            disableDoubleClick: true,
            disableDoubleClickZoom: true
        };

        map = new kakao.maps.Map(mapContainer, mapOption);
        isMapInitialized = true;

        // Start live tracking
        startLocationTracking();
    }

    function startLocationTracking() {
        if (locationWatchId) navigator.geolocation.clearWatch(locationWatchId);

        const watchOptions = {
            enableHighAccuracy: true,
            timeout: 6000,
            maximumAge: 1000
        };

        locationWatchId = navigator.geolocation.watchPosition(
            function(position) {
                const newPosition = [position.coords.latitude, position.coords.longitude];

                if (!lastKnownPosition || calculateDistance(lastKnownPosition, newPosition) > MIN_MOVEMENT_THRESHOLD_METERS) {
                    lastSignificantMovementTime = Date.now();
                    lastKnownPosition = newPosition;
                    startLocation = newPosition;

                    updateTraveledTrace(newPosition);
                    setStartMarker();

                    map.setCenter(new kakao.maps.LatLng(newPosition[0], newPosition[1]));
                    map.setLevel(6);
                }
            },
            function(error) {
                console.error("GPS Error:", error);
                if (timerContainerElement) {
                    timerContainerElement.innerHTML = "GPS unavailable";
                }
            },
            watchOptions
        );
    }

    // Initialize Kakao Map
    if (typeof kakao !== 'undefined' && kakao.maps) {
        kakao.maps.load(function() {
            try {
                init();
            } catch (e) {
                console.error(e);
                document.getElementById('map').innerHTML = '<div class="error-message">Map failed to load</div>';
            }
        });
    }
})();
