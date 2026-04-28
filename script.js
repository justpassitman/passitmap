(function() {
    const KAKAO_API_KEY = "00a03dac8488d12731e4021756938e72";

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
    let isMapInitialized = false;
    let lastSignificantMovementTime = Date.now();

    const baseMarkerSize = 18;
    const maxMarkerSize = 28;
    const MIN_MOVEMENT_THRESHOLD_METERS = 5;

    const duckImageSrc = 'duck.png';

    let timerContainerElement = null;
    let duckImageElement = null;
    let duckMarkerContainer = null;

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
                strokeWeight: 2.5,           // Thinner line
                strokeColor: '#39FF14',      // Lime green
                strokeOpacity: 0.85,
                strokeStyle: 'solid'
            });
        }

        if (lastTracePosition) {
            const segment = calculateDistance(lastTracePosition, newPosition);
            totalDistanceTraveled += segment;
        }
        lastTracePosition = newPosition;

        updateTraveledDistanceDisplay();
    }

    // ONE SINGLE LINE distance display
    function updateTraveledDistanceDisplay() {
        const kmTraveled = (totalDistanceTraveled / 1000).toFixed(2);
        
        if (timerContainerElement) {
            timerContainerElement.textContent = `${kmTraveled} km`;
        }
    }

    function setStartMarker() {
        if (!isMapInitialized || !startLocation) return;

        const currentLevel = map.getLevel();
        const scale = Math.min(Math.max(baseMarkerSize, baseMarkerSize * (currentLevel / 2)), maxMarkerSize);

        const content = `<div id="duck-marker-container" style="position: relative; width: ${scale}px; height: ${scale}px;">
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

    function init() {
        timerContainerElement = document.getElementById('timer-container');
        timerContainerElement.style.display = 'block';
        timerContainerElement.style.background = 'transparent';
        timerContainerElement.style.padding = '4px 8px';
        timerContainerElement.style.fontSize = '15px';
        timerContainerElement.style.fontWeight = '700';
        timerContainerElement.style.color = 'rgba(0, 0, 0, 0.9)';
        timerContainerElement.style.textShadow = '0 1px 3px rgba(255,255,255,0.9)';

        const mapContainer = document.getElementById('map');

        const mapOption = {
            center: new kakao.maps.LatLng(37.5665, 126.9780),
            level: 7,
            draggable: false,
            scrollwheel: false,
            disableDoubleClick: true,
            disableDoubleClickZoom: true
        };

        map = new kakao.maps.Map(mapContainer, mapOption);
        isMapInitialized = true;

        startLocationTracking();
    }

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

                    updateTraveledTrace(newPosition);
                    setStartMarker();

                    map.setCenter(new kakao.maps.LatLng(newPosition[0], newPosition[1]));
                    map.setLevel(6);
                }
            },
            function(error) {
                console.error("GPS Error:", error);
                if (timerContainerElement) {
                    timerContainerElement.textContent = "GPS unavailable";
                }
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

    // Start the map
    if (typeof kakao !== 'undefined' && kakao.maps) {
        kakao.maps.load(function() {
            try {
                init();
            } catch (e) {
                console.error("Map init error:", e);
            }
        });
    }
})();
