(function() {
    const KAKAO_API_KEY = "dad89b90a6acaa5acadc74e2329cab63";
    const ORS_API_KEY = "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6IjBjMGUyMGY3YmM4NzQwNWY5ZDUyYzE4Y2VkMjI1Mjc1IiwiaCI6Im11cm11cjY0In0=";

    let destinationLocation = null;
    const gentleAnimationDistance = 1500;
    const veryFastAnimationDistance = 700;
    const arrivalDistance = 100;
    const maxMarkerSize = 30;
    const baseMarkerSize = 20;
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
                    console.warn(`Retrying ${url} in ${delay}ms...`);
                    await new Promise(res => setTimeout(res, delay));
                    return retryFetch(url, options, retries - 1, delay * 2);
                }
                throw response;
            }
            return response;
        } catch (error) {
            if (retries > 0) {
                console.warn(`Retrying ${url} in ${delay}ms due to network error...`);
                await new Promise(res => setTimeout(res, delay));
                return retryFetch(url, options, retries - 1, delay * 2);
            }
            throw error;
        }
    }

    function updateAllMarkerSizes(level, remainingTravelDistance) {
        if (!startOverlay || !duckImageElement) return;

        const duckScale = Math.min(Math.max(baseMarkerSize, baseMarkerSize * (level / 2)), maxMarkerSize);
        duckImageElement.style.width = `${duckScale}px`;
        duckImageElement.style.height = `${duckScale}px`;

        if (destinationMarkerContainer) {
            let destinationScale = 0;
            if (remainingTravelDistance < gentleAnimationDistance) {
                destinationScale = duckScale * gentleMarkerMultiplier;
            } else if (remainingTravelDistance < veryFastAnimationDistance) {
                destinationScale = duckScale * energeticMarkerMultiplier;
            } else {
                destinationScale = duckScale * destinationSizeMultiplier;
            }
            destinationMarkerContainer.style.width = `${destinationScale}px`;
            destinationMarkerContainer.style.height = `${destinationScale}px`;
        }
    }

    function updateDestinationMarkerState(state, duckScale) {
        if (!isMapInitialized || !destinationLocation) {
            return;
        }

        let content = '';
        let className = '';
        let imgSrc = '';
        let destinationScale = 0;

        if (state === 'default') {
            destinationScale = duckScale * destinationSizeMultiplier;
            content = `<div id="destination-marker-container" style="width: ${destinationScale}px; height: ${destinationScale}px;"><svg class="classic-marker-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5s2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg></div>`;
        } else if (state === 'gentle') {
            destinationScale = duckScale * gentleMarkerMultiplier;
            className = '';
            imgSrc = gentleDestinationImageSrc;
        } else if (state === 'very-fast') {
            destinationScale = duckScale * energeticMarkerMultiplier;
            className = 'destination-marker-very-fast';
            imgSrc = energeticDestinationImageSrc;
        } else if (state === 'arrived') {
            destinationScale = duckScale * energeticMarkerMultiplier;
            className = 'destination-marker-very-fast';
            imgSrc = energeticDestinationImageSrc;
        }

        if (state !== 'default') {
            content = `<div id="destination-marker-container" style="width: ${destinationScale}px; height: ${destinationScale}px;"><img id="destination-image" src="${imgSrc}" alt="Destination" class="destination-image ${className}"></div>`;
        }

        if (destinationOverlay) {
            destinationOverlay.setContent(content);
        } else {
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
        if (!isMapInitialized) return;

        let shouldFlip = false;
        if (startLocation && destinationLocation) {
            if (startLocation[1] > destinationLocation[1]) {
                shouldFlip = true;
            }
        }

        const currentLevel = map.getLevel();
        const scale = Math.min(Math.max(baseMarkerSize, baseMarkerSize * (currentLevel / 2)), maxMarkerSize);

        if (startOverlay) {
            startOverlay.setPosition(new kakao.maps.LatLng(startLocation[0], startLocation[1]));
            if (duckImageElement) {
                duckImageElement.style.transform = shouldFlip ? 'scaleX(-1)' : 'scaleX(1)';
            }
        } else {
            const content = `<div id="duck-marker-container" style="position: relative; width: ${scale}px; height: ${scale}px; transform-origin: center bottom;"><img id="duck-image" src="${duckImageSrc}" alt="Current Position" class="wiggle-duck" style="width: 100%; height: 100%; ${shouldFlip ? 'transform: scaleX(-1);' : ''}"></div>`;
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

        if (quackDirection === 'left') {
            quack.classList.add('quack-right');
            quackDirection = 'right';
        } else {
            quack.classList.add('quack-left');
            quackDirection = 'left';
        }
        duckMarkerContainer.appendChild(quack);

        setTimeout(() => {
            quack.remove();
        }, 500);
    }

    function startQuacking() {
        if (quackIntervalId) return;
        quackIntervalId = setInterval(createQuack, 500);
    }

    function stopQuacking() {
        if (quackIntervalId) {
            clearInterval(quackIntervalId);
            quackIntervalId = null;
            if (duckMarkerContainer) {
                const quacks = duckMarkerContainer.querySelectorAll('.quack-text');
                quacks.forEach(q => q.remove());
            }
        }
    }

    function init() {
        timerContainerElement = document.getElementById('timer-container');
        timerContainerElement.style.display = 'block';
        timerContainerElement.innerHTML = '⏳';

        const mapContainer = document.getElementById('map');
        if (KAKAO_API_KEY.includes("YOUR_KAKAO_API_KEY") || ORS_API_KEY.includes("YOUR_ORS_API_KEY")) {
            mapContainer.innerHTML = '<div class="error-message">🔑 Please replace API keys with your actual keys.</div>';
            return;
        }

        const mapOption = {
            center: new kakao.maps.LatLng(37.5665, 126.9780),
            level: 9,
            draggable: false,
            scrollwheel: false,
            disableDoubleClick: true,
            disableDoubleClickZoom: true
        };
        map = new kakao.maps.Map(mapContainer, mapOption);
        isMapInitialized = true;

        kakao.maps.event.addListener(map, 'zoom_changed', function() {
            const level = map.getLevel();
        });

        const urlParams = new URLSearchParams(window.location.search);
        const destinationAddress = urlParams.get('destination');

        // --- MODIFICATION: Check for destination and adjust behavior ---
        if (!destinationAddress) {
            timerContainerElement.innerHTML = '📍 Showing your current location.';
            startOnlyLocationTracking();
        } else {
            processDestination(destinationAddress);
        }
    }

    function updateMapViewToFitMarkers() {
        if (!isMapInitialized || !startLocation || !destinationLocation) {
            return;
        }
        const bounds = new kakao.maps.LatLngBounds();
        bounds.extend(new kakao.maps.LatLng(startLocation[0], startLocation[1]));
        bounds.extend(new kakao.maps.LatLng(destinationLocation[0], destinationLocation[1]));
        map.setBounds(bounds, 20);
    }

    async function tryGeocodeWithKakao(query) {
        if (!KAKAO_API_KEY) {
            throw new Error("🔑 Kakao API key missing.");
        }
        const kakaoGeocodeUrl = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(query)}`;
        try {
            const kakaoResponse = await retryFetch(kakaoGeocodeUrl, {
                method: 'GET',
                headers: {
                    'Authorization': `KakaoAK ${KAKAO_API_KEY}`
                }
            });
            if (!kakaoResponse.ok) {
                const errorData = await kakaoResponse.json().catch(() => ({}));
                let errorMessage = `Kakao Geocoding failed: Status ${kakaoResponse.status}`;
                if (errorData.code === -401) {
                    errorMessage = "🔑 Kakao API key invalid or rate limit exceeded.";
                } else if (errorData.message) {
                    errorMessage = `Kakao Geocoding error: ${errorData.message}`;
                }
                throw new Error(errorMessage);
            }
            const kakaoData = await kakaoResponse.json();
            if (kakaoData.documents && kakaoData.documents.length > 0) {
                const firstResult = kakaoData.documents[0];
                return {
                    lat: parseFloat(firstResult.y),
                    lng: parseFloat(firstResult.x),
                    label: firstResult.address_name
                };
            }
        } catch (error) {
            console.error("Kakao Geocoding failed:", error);
            throw error;
        }
        return null;
    }

    async function tryGeocodeWithORS(query) {
        if (!ORS_API_KEY) {
            throw new Error("🔑 ORS API key missing.");
        }
        try {
            const geocodeUrl = `https://api.openrouteservice.org/geocode/search?api_key=${ORS_API_KEY}&text=${encodeURIComponent(query)}`;
            const geocodeResponse = await retryFetch(geocodeUrl);
            if (!geocodeResponse.ok) {
                const errorData = await geocodeResponse.json().catch(() => ({}));
                let errorMessage = `ORS Geocoding failed: Status ${geocodeResponse.status}`;
                if (geocodeResponse.status === 403) {
                    errorMessage = "🔑 ORS API key invalid.";
                } else if (errorData.error && errorData.error.message) {
                    errorMessage = `ORS Geocoding error: ${errorData.error.message}`;
                }
                throw new Error(errorMessage);
            }
            const geocodeData = await geocodeResponse.json();
            if (geocodeData.features.length > 0) {
                const firstResult = geocodeData.features[0];
                const destPoint = firstResult.geometry.coordinates;
                return {
                    lat: destPoint[1],
                    lng: destPoint[0],
                    label: firstResult.properties.label
                };
            }
        } catch (error) {
            console.error("ORS Geocoding failed:", error);
            throw error;
        }
        return null;
    }

    async function processDestination(destination) {
        if (timerContainerElement) {
            timerContainerElement.innerHTML = 'Finding destination... 🔍';
        }
        const getUserLocation = () => new Promise((resolve, reject) => {
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    enableHighAccuracy: true,
                    timeout: 10000,
                    maximumAge: 0
                });
            } else {
                reject(new Error("😵‍💫 GPS not supported."));
            }
        });

        try {
            const position = await getUserLocation();
            startLocation = [position.coords.latitude, position.coords.longitude];

            let foundDestination = null;
            const cachedDestination = sessionStorage.getItem(`destination_${destination}`);
            if (cachedDestination) {
                console.log("Using cached destination.");
                foundDestination = JSON.parse(cachedDestination);
            } else {
                foundDestination = await tryGeocodeWithKakao(destination);
                if (!foundDestination) {
                    foundDestination = await tryGeocodeWithORS(destination);
                }
                if (!foundDestination) {
                    foundDestination = await tryGeocodeWithORS(destination + ", Seoul");
                }
                if (foundDestination) {
                    sessionStorage.setItem(`destination_${destination}`, JSON.stringify(foundDestination));
                }
            }

            if (foundDestination) {
                destinationLocation = [foundDestination.lat, foundDestination.lng];
                setStartMarker();
                const currentLevel = map.getLevel();
                const duckScale = Math.min(Math.max(baseMarkerSize, baseMarkerSize * (currentLevel / 2)), maxMarkerSize);
                updateDestinationMarkerState('default', duckScale);
                updateMapViewToFitMarkers();
                getFullRouteAndTravelTime();
                startLocationPolling();
            } else {
                if (timerContainerElement) {
                    timerContainerElement.innerHTML = '🤯 Address not found. Please try a different one.';
                }
            }
        } catch (error) {
            console.error("Error:", error);
            if (timerContainerElement) {
                timerContainerElement.innerHTML = error.message;
            }
        }
    }

    // --- NEW FUNCTION: Tracks location without a destination ---
    function startOnlyLocationTracking() {
        if (locationWatchId) {
            navigator.geolocation.clearWatch(locationWatchId);
        }

        const watchOptions = {
            enableHighAccuracy: true,
            timeout: 5000,
            maximumAge: 0
        };

        locationWatchId = navigator.geolocation.watchPosition(
            function(position) {
                startLocation = [position.coords.latitude, position.coords.longitude];
                setStartMarker();
                map.setCenter(new kakao.maps.LatLng(startLocation[0], startLocation[1]));
                map.setLevel(3); // Set a good zoom level for local view
                timerContainerElement.innerHTML = '📍 Your location is being tracked.';
                
                // Ensure no destination marker or polyline is on the map
                if (destinationOverlay) {
                    destinationOverlay.setMap(null);
                }
                if (currentPolyline) {
                    currentPolyline.setMap(null);
                }
                if (duckImageElement) {
                    duckImageElement.classList.remove('wiggle-duck');
                }
            },
            function(error) {
                console.error("Location tracking error:", error);
                let errorMessage = "😵 GPS out";
                switch (error.code) {
                    case error.PERMISSION_DENIED:
                        errorMessage = "🚫 GPS access denied. Please enable location services.";
                        break;
                    case error.POSITION_UNAVAILABLE:
                        errorMessage = "📡 GPS signal unavailable. Trying to reconnect...";
                        break;
                    case error.TIMEOUT:
                        errorMessage = "⏰ GPS timeout. Check your signal.";
                        break;
                }
                if (timerContainerElement) {
                    timerContainerElement.innerHTML = errorMessage;
                }
            },
            watchOptions
        );
    }

    function checkIdleState() {
        if (Date.now() - lastSignificantMovementTime > IDLE_DURATION_THRESHOLD_MS && !isIdleMode) {
            console.log("Entering idle GPS mode.");
            isIdleMode = true;
            startLocationPolling();
        }
    }

    function startLocationPolling() {
        if (locationWatchId) {
            navigator.geolocation.clearWatch(locationWatchId);
            locationWatchId = null;
        }
        if (idleCheckTimer) {
            clearInterval(idleCheckTimer);
            idleCheckTimer = null;
        }

        const watchOptions = {
            enableHighAccuracy: isIdleMode ? false : true,
            timeout: isIdleMode ? 30000 : (isHighAccuracyMode ? 2000 : 5000),
            maximumAge: isIdleMode ? 5000 : 1000
        };

        const updateRouteLogic = function(position) {
            const newPosition = [position.coords.latitude, position.coords.longitude];
            if (!lastKnownPosition || calculateDistance(lastKnownPosition, newPosition) > MIN_MOVEMENT_THRESHOLD_METERS) {
                lastSignificantMovementTime = Date.now();
                if (isIdleMode) {
                    console.log("Exiting idle GPS mode due to movement.");
                    isIdleMode = false;
                    startLocationPolling();
                }
                lastKnownPosition = newPosition;
                startLocation = newPosition;
                setStartMarker();
                updateRouteOnMap(newPosition);
            } else {
                console.log("Skipping update: moved less than " + MIN_MOVEMENT_THRESHOLD_METERS + " meters.");
            }
        };

        const throttledUpdateRoute = throttle(updateRouteLogic, 500);

        locationWatchId = navigator.geolocation.watchPosition(
            throttledUpdateRoute,
            error => {
                console.error("Real-time geolocation error:", error);
                if (locationWatchId) {
                    navigator.geolocation.clearWatch(locationWatchId);
                }
                let errorMessage = "😵 GPS out";
                switch (error.code) {
                    case error.PERMISSION_DENIED:
                        errorMessage = "🚫 GPS access denied. Please enable location services.";
                        break;
                    case error.POSITION_UNAVAILABLE:
                        errorMessage = "📡 GPS signal unavailable. Trying to reconnect...";
                        break;
                    case error.TIMEOUT:
                        errorMessage = "⏰ GPS timeout. Check your signal.";
                        break;
                }
                if (timerContainerElement) {
                    timerContainerElement.innerHTML = errorMessage;
                }
            },
            watchOptions
        );

        idleCheckTimer = setInterval(checkIdleState, IDLE_DETECTION_INTERVAL_MS);
    }

    function calculateDistance(coord1, coord2) {
        const toRad = x => x * Math.PI / 180;
        const R = 6371e3; // Earth's radius in meters

        const dLat = toRad(coord2[0] - coord1[0]);
        const dLng = toRad(coord2[1] - coord1[1]);

        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(coord1[0])) * Math.cos(toRad(coord2[0])) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return R * c;
    }

    function calculateRemainingTravelDistance(polyline) {
        let distance = 0;
        for (let i = 0; i < polyline.length - 1; i++) {
            distance += calculateDistance(
                [polyline[i].getLat(), polyline[i].getLng()],
                [polyline[i + 1].getLat(), polyline[i + 1].getLng()]
            );
        }
        return distance;
    }

    async function getFullRouteAndTravelTime() {
        if (!startLocation || !destinationLocation) {
            return;
        }

        if (timerContainerElement) {
            timerContainerElement.innerHTML = 'Calculating cycling route... 🚴';
        }

        try {
            const orsCoords = [
                [startLocation[1], startLocation[0]],
                [destinationLocation[1], destinationLocation[0]]
            ];

            const directionsUrl = `https://api.openrouteservice.org/v2/directions/cycling-regular`;
            const payload = {
                coordinates: orsCoords
            };

            const response = await retryFetch(directionsUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': ORS_API_KEY
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                let errorMessage = "🗺️ No route found";
                if (response.status === 403) {
                    errorMessage = "🔑 ORS API key invalid.";
                } else if (errorData.error && errorData.error.message) {
                    errorMessage = `🗺️ Route error: ${errorData.error.message}`;
                }
                if (timerContainerElement) {
                    timerContainerElement.innerHTML = errorMessage;
                }
                routeIsFetched = false;
                return;
            }

            const data = await response.json();

            if (data && data.routes && data.routes.length > 0) {
                const route = data.routes[0];
                const encodedGeometry = route.geometry;
                fullRouteDistance = route.summary.distance > 0 ? route.summary.distance : 1;
                fullRouteDuration = route.summary.duration;

                const routeCoordinates = decodePolyline(encodedGeometry);
                fullPolylinePath = routeCoordinates.map(coord => new kakao.maps.LatLng(coord[0], coord[1]));
                routeIsFetched = true;
                updateRouteOnMap(startLocation);
            } else {
                if (timerContainerElement) {
                    timerContainerElement.innerHTML = "🤯 Routing data could not be found.";
                }
                routeIsFetched = false;
            }
        } catch (error) {
            console.error("Routing Error:", error);
            if (timerContainerElement) {
                timerContainerElement.innerHTML = error.message;
            }
            routeIsFetched = false;
        }
    }

    function decodePolyline(encoded) {
        let points = [];
        let index = 0,
            len = encoded.length;
        let lat = 0,
            lng = 0;

        while (index < len) {
            let b, shift = 0,
                result = 0;
            do {
                b = encoded.charCodeAt(index++) - 63;
                result |= (b & 0x1f) << shift;
                shift += 5;
            } while (b >= 0x20);
            let dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
            lat += dlat;

            shift = 0;
            result = 0;
            do {
                b = encoded.charCodeAt(index++) - 63;
                result |= (b & 0x1f) << shift;
                shift += 5;
            } while (b >= 0x20);
            let dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
            lng += dlng;

            points.push([lat / 1e5, lng / 1e5]);
        }
        return points;
    }

    function updateRouteOnMap(currentPos) {
        if (!map || !fullPolylinePath || !routeIsFetched) {
            return 0;
        }

        const currentPosLatLng = new kakao.maps.LatLng(currentPos[0], currentPos[1]);
        const destinationLatLng = new kakao.maps.LatLng(destinationLocation[0], destinationLocation[1]);

        const flyDistance = calculateDistance(currentPos, destinationLocation);

        const currentLevel = map.getLevel();
        const duckScale = Math.min(Math.max(baseMarkerSize, baseMarkerSize * (currentLevel / 2)), maxMarkerSize);

        let minDistance = Infinity;
        let closestPointIndex = -1;
        for (let i = 0; i < fullPolylinePath.length; i++) {
            const distance = calculateDistance(currentPos, [fullPolylinePath[i].getLat(), fullPolylinePath[i].getLng()]);
            if (distance < minDistance) {
                minDistance = distance;
                closestPointIndex = i;
            }
        }

        if (minDistance > OFF_ROUTE_THRESHOLD_METERS && routeIsFetched) {
            console.warn("User is significantly off route. Recalculating cycling route...");
            routeIsFetched = false; // Force re-fetch
            getFullRouteAndTravelTime();
            return remainingTravelDistance;
        }

        const remainingPolyline = fullPolylinePath.slice(closestPointIndex);

        if (currentPolyline) {
            currentPolyline.setPath(remainingPolyline);
        } else {
            currentPolyline = new kakao.maps.Polyline({
                path: remainingPolyline,
                strokeWeight: 4,
                strokeColor: '#00B050',
                strokeOpacity: 0.8,
                strokeStyle: 'solid'
            });
            currentPolyline.setMap(map);
        }

        const remainingTravelDistance = calculateRemainingTravelDistance(remainingPolyline);

        const shouldActivateQuackAndBounce = (flyDistance < QUACK_ACTIVATION_DISTANCE || remainingTravelDistance < veryFastAnimationDistance) && flyDistance >= arrivalDistance;

        if (shouldActivateQuackAndBounce) {
            if (duckImageElement) {
                duckImageElement.classList.add('wiggle-duck');
            }
            if (!quackIntervalId) {
                startQuacking();
            }
        } else {
            if (duckImageElement) {
                duckImageElement.classList.remove('wiggle-duck');
            }
            if (quackIntervalId) {
                stopQuacking();
            }
        }

        if (flyDistance < arrivalDistance) {
            updateDestinationMarkerState('arrived', duckScale);
            if (duckImageElement) {
                duckImageElement.classList.add('wiggle-duck');
            }
            if (timerContainerElement) {
                timerContainerElement.style.display = 'none';
            }
            if (currentPolyline) {
                currentPolyline.setMap(null);
                currentPolyline = null;
            }
            if (locationWatchId) {
                navigator.geolocation.clearWatch(locationWatchId);
                locationWatchId = null;
            }
            if (!quackIntervalId) {
                startQuacking();
            }
            map.setCenter(destinationLatLng);
            map.setLevel(3);
            return flyDistance;
        }

        if (flyDistance < 350) {
            updateDestinationMarkerState('very-fast', duckScale);
            if (timerContainerElement) {
                timerContainerElement.style.display = 'block';
            }
        } else if (remainingTravelDistance < veryFastAnimationDistance) {
            updateDestinationMarkerState('very-fast', duckScale);
            if (timerContainerElement) {
                timerContainerElement.style.display = 'block';
            }
        } else if (remainingTravelDistance < gentleAnimationDistance) {
            updateDestinationMarkerState('gentle', duckScale);
            if (timerContainerElement) {
                timerContainerElement.style.display = 'block';
            }
        } else {
            updateDestinationMarkerState('default', duckScale);
            if (timerContainerElement) {
                timerContainerElement.style.display = 'block';
            }
        }

        updateAllMarkerSizes(currentLevel, remainingTravelDistance);

        const remainingProgress = remainingTravelDistance / fullRouteDistance;
        const remainingDurationInSeconds = fullRouteDuration * remainingProgress;
        const durationInMinutes = Math.ceil(remainingDurationInSeconds / 60);

        if (timerContainerElement) {
            timerContainerElement.innerHTML = `<b>${durationInMinutes} min</b>`;
        }

        if (startOverlay) {
            startOverlay.setPosition(currentPosLatLng);
        } else {
            setStartMarker();
        }

        if (remainingTravelDistance < HIGH_ACCURACY_THRESHOLD_METERS && !isHighAccuracyMode) {
            console.log("Entering high-accuracy mode.");
            isHighAccuracyMode = true;
            startLocationPolling();
            return remainingTravelDistance;
        } else if (remainingTravelDistance >= HIGH_ACCURACY_THRESHOLD_METERS && isHighAccuracyMode) {
            console.log("Exiting high-accuracy mode.");
            isHighAccuracyMode = false;
            startLocationPolling();
            return remainingTravelDistance;
        }

        if (remainingTravelDistance < centerOnDestinationThreshold) {
            updateMapViewToFitMarkers();
        } else {
            updateMapViewToFitMarkers();
        }

        return remainingTravelDistance;
    }

    if (typeof kakao !== 'undefined' && kakao.maps) {
        kakao.maps.load(function() {
            try {
                init();
            } catch (e) {
                console.error("Error during Kakao Maps initialization:", e);
                const mapContainer = document.getElementById('map');
                if (mapContainer) {
                    mapContainer.innerHTML = '<div class="error-message">An error occurred during map initialization. Please check console for details.</div>';
                }
            }
        });
    } else {
        const mapContainer = document.getElementById('map');
        if (mapContainer) {
            mapContainer.innerHTML = '<div class="error-message">Kakao Maps API failed to load. Please check your script tag and API key.</div>';
        }
    }
})();
