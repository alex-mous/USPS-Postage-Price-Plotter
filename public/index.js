
const ACCESS_TOKEN = 'pk.eyJ1IjoidHN1aG8iLCJhIjoiY2tpb3Y4YmhsMDBhaTJxbXZnNTB3YjNjNSJ9.q0AFLz--FVVwK9MUB7gcSg';
mapboxgl.accessToken = ACCESS_TOKEN;
const mapboxClient = mapboxSdk({ accessToken: ACCESS_TOKEN });
const defaultPosition = [-95, 39]; //GPS default position - center US (default Zip - 66052)
const HOST = "https://postagepriceplotter.see-making.com";

/**
 * Location storage (for starting and ending markers)
 * @typedef {Object} Location
 * @param {string} zipCode US Zip Code (if any)
 * @param {string} country Country name
 * @param {string} countryCode Country code (2 letters)
 */

 /**
 * Package information
 * @typedef {Object} PackageDetails
 * @param {number} pounds Weight (pounds, 0-69)
 * @param {number} country Weight (ounces, 0-16)
 * @param {number} width Width (inches)
 * @param {number} length Length (inches)
 * @param {number} height Height (inches)
 * @param {number} price Shipping item price ($)
 * @param {string} machinable Package machinability (TRUE/FALSE)
 * @param {string} serviceType Type of services to select (ALL/PRIORITY/FIRST CLASS)
 * @param {string} packageType Type of packages/parcels to select (ALL/LETTER/POSTCARD/LARGEENVELOPE/PACKAGE/FLATRATE)
 */

/**
 * Get the Location from the longitude/latitude
 * 
 * @param {number} lng Longitude
 * @param {number} lat Latitude
 * @returns {Location} Location
 */
const getLocationFromGPS = async (lng, lat) => {
    let data = (await mapboxClient.geocoding.reverseGeocode({query: [lng, lat]})
        .send())
        .body
        .features;
    let zipCode = data
        .filter(n => n.place_type?.[0] == "postcode")
        ?.[0]
        ?.text;
    let country = data
        .filter(n => n.place_type?.[0] == "country")
        ?.[0]
        ?.place_name;
    let countryCode = data
        .filter(n => n.place_type?.[0] == "country")
        ?.[0]
        ?.properties
        ?.short_code
        ?.toUpperCase();
    if (!zipCode && !country) { //No country nor zip found - invalid location
        alert("Please select a location within a country");
    }

    return {
        zipCode: zipCode,
        country: country,
        countryCode: countryCode
    }
}

/**
 * Get the longitude/latitude from the Location
 * 
 * @param {Location} loc Location to decode
 * @returns {Array} Array of longitude and latitude or undefined if does not exist
 */
const getGPSFromLocation = async (loc) => {
    let data = (await mapboxClient.geocoding.forwardGeocode({
        query: loc.country == "United States" ? loc.zipCode : loc.country,
        countries: [loc.countryCode]
    })
        .send())
        .body
        .features;
    return (
        data.filter(n => loc.country == "United States" ? (n.place_type?.[0] == "postcode") : (n.place_type?.[0] == "country"))
            ?.[0]
            ?.center
    );
}

/**
 * Get the current shipping information based on starting location, destination location, and package information
 * 
 * @async
 * @param {Location} startLoc Starting location
 * @param {Location} endLoc Ending location
 * @param {PackageDetails} packageDetails Package information
 * @returns {Object} API response
 */
const getShippingInfo = (startLoc, endLoc, packageDetails) => {
    if (!startLoc || !endLoc || !packageDetails) return;
    console.log("Running shipping info");
    if (!startLoc.zipCode) { //Starting location not inside of US
        alert("Please set the origin marker inside of the United States");
        return;
    }
    if (endLoc.country != "United States") {
        console.log("International request for country: ", endLoc.country);
        return getAPIData({
            type: "international",
            country: endLoc.country, 
            weight: packageDetails
        });
    } else if (endLoc.zipCode) {
        console.log("Domestic request for end zip: ", endLoc.zipCode);
        return getAPIData({
            type: "domestic",
            zipStart: startLoc.zipCode,
            zipEnd: endLoc.zipCode, 
            weight: packageDetails
        });
    }
}

/**
 * Get and show the shipping data in the results box
 * 
 * @async
 * @param {Location} startLoc Starting location
 * @param {Location} endLoc Ending location
 * @param {PackageDetails} packageDetails Package information
 */
const showShippingInfo = async (startLoc, endLoc, packageDetails) => {
    document.querySelector("#resTable").innerHTML = "";
    let msgBx = document.querySelector("#resMsg");
    msgBx.classList.remove("d-none");
    msgBx.innerHTML = "Loading...";
    $("#optionsTab").tab("dispose");
    $("#resultsTab").tab("show");
    
    let apiResp = await getShippingInfo(startLoc, endLoc, packageDetails);

    if (apiResp.err) {
        msgBx.classList.add("text-danger");
        msgBx.innerHTML = "Error: " + apiResp.err;
        return;
    } else {
        msgBx.classList.add("d-none");
    }
    console.log("Received result from API: ", apiResp);
    apiResp.forEach((pkg) => {
        if (pkg.Error) {
            console.log("Error from API: ", pkg.Error);
            return;
        }
        pkg?.Postage //Domestic
            ?.sort((a,b) => parseFloat(a.Rate[0]) - parseFloat(b.Rate[0]))
            ?.forEach((res) => {
                let row = document.createElement("TR");
                let name = new DOMParser().parseFromString(res.MailService[0], "text/html").documentElement.textContent; //Parse HTML from escapes
                row.innerHTML = `<td>${name}</td><td>$${decodeURIComponent(res.Rate[0])}</td>`;
                document.querySelector("#resTable").appendChild(row);
            });
        pkg?.Service //International
            ?.sort((a,b) => parseFloat(a.Postage[0]) - parseFloat(b.Postage[0]))
            ?.forEach((res) => {
                if (!res.SvcDescription) return; //Not a shipping service
                let row = document.createElement("TR");
                let name = new DOMParser().parseFromString(res.SvcDescription[0], "text/html").documentElement.textContent; //Parse HTML from escapes
                row.innerHTML = `<td>${name}</td><td>$${decodeURIComponent(res.Postage[0])}</td>`;
                document.querySelector("#resTable").appendChild(row);
            });
    });
    if (document.querySelector("#resTable").children.length == 0) {
        let row = document.createElement("TR");
        row.innerHTML = `<td colspan='2'>No valid combinations found</td>`;
        document.querySelector("#resTable").appendChild(row);
    }
}

/**
 * Fetch result from API
 * 
 * @async
 * @param {Object} body Request body passed to API
 * @returns {Object} API response
 */
const getAPIData = (body) => {
    return fetch(`${HOST}/api/price`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    })
        .then(res => res.json());
}


/**
 * Update a marker on the map to a new location
 * 
 * @param {Object} marker Marker object
 * @param {Object} loc Location [lng, lat]
 * @param {Object} map Map object
 */
const updateMarker = (marker, loc, map) => {
    marker.setLngLat(loc);
    marker.addTo(map);
}

/**
 * Update a range and label with the value
 * @param {string} id ID of the range element
 */
const updateRangeValue = (id) => {
	document.querySelector(`#${id}Txt`).innerText = document.querySelector(`#${id}`).value;
}

/**
 * Get the bounding box for all of the markers
 * @param  {...any} markers Markers
 * @returns {Object} Bounding box
 */
const getBounding = (...markers) => {
    let bounding = new mapboxgl.LngLatBounds();
    markers.forEach(marker => {
        bounding.extend(marker.getLngLat());
    });
    //Add padding to bounding box
    let paddingLng = Math.abs(bounding.getNorthEast().lng - bounding.getSouthWest().lng)/3;
    let paddingLat = Math.abs(bounding.getNorthEast().lat - bounding.getSouthWest().lat)/3;
    bounding.setNorthEast([bounding.getNorthEast().lng + paddingLng, bounding.getNorthEast().lat + paddingLat]);
    bounding.setSouthWest([bounding.getSouthWest().lng - paddingLng, bounding.getSouthWest().lat - paddingLat]);
    return bounding;
}

/**
 * Toggle the form for domestic/international
 * 
 * @param {boolean} toInternational Change to international if true
 * @param {boolean} toggleRadios Whether to toggle the radio buttons too or not
 */
const toggleDomesticInternationalForm = (toInternational, toggleRadios) => {
    document.querySelectorAll('.shippingDestForms').forEach((form, i) => { //Open/close form sections
        form.classList.toggle("d-none", i%2!=toInternational);
        form.querySelectorAll("input, select").forEach(inpt => inpt.disabled = i%2!=toInternational); //Toggle states of inputs to prevent error on submit
    });
    if (toggleRadios) {
        if (toInternational) {
            $("#internationalRadio").parent().button("toggle");
        } else {
            $("#domesticRadio").parent().button("toggle");
        }
    }
}

/**
 * Set a radio input with name to value
 * 
 * @param {*} name 
 * @param {*} val 
 */
const setRadio = (name, val) => {
    $(`input[name='${name}'][value='${val}']`).parent().button("toggle");
    $(`input[name='${name}'][value='${val}']`).prop("check", true);
}

/**
 * Set marker to GPS from map and return Location object
 * 
 * @param {Object} mem marker and GPS from memory
 * @param {*} marker Marker to set
 * @param {*} map Map to add marker to
 * @returns {Location} Location of marker
 */
const addMarkerFromMemory = (mem, marker, map) => {
    if (mem) {
        let tmp = JSON.parse(mem);
        marker.setLngLat(tmp);
        marker.addTo(map);
        return tmp.loc;
    }
}

/**
 * Update the destination marker location on screen
 * 
 * @param {Location} destMarkerLoc Destination marker location
 */
const updateDestMarkerLoc = (destMarkerLoc) => {
    if (destMarkerLoc.country == "United States") {
        toggleDomesticInternationalForm(false, true);
        document.querySelector("#destZipCode").value = destMarkerLoc.zipCode;
    } else {
        toggleDomesticInternationalForm(true, true);
        document.querySelector("#destCountry").value = destMarkerLoc.countryCode;
    }
}

/**
 * Update the home marker location on screen
 * 
 * @param {Location} homeMarkerLoc Home marker location
 */
const updateHomeMarkerLoc = (homeMarkerLoc) => {
    document.querySelector("#originZipCode").value = homeMarkerLoc.zipCode;
}



window.onload = () => {
    let homeMarkerLoc; //Cache location to reduce API calls and persist destination on reload
    let destMarkerLoc;
    let packageDetails = window.localStorage.packageDetails;
    
    if (!packageDetails) {
        packageDetails = { //Set default package details
            pounds: 0,
            ounces: 1,
            width: 7,
            length: 5,
            height: 1,
            price: 0,
            machinable: "TRUE",
            serviceType: "ALL",
            packageType: "ALL"
        }
    } else {
        packageDetails = JSON.parse(packageDetails);
        console.log("Read package details from memory: ", packageDetails);
    }

    const map = new mapboxgl.Map({ //Create map
        container: 'map',
        style: 'mapbox://styles/tsuho/ckiqb4rmv4s0017od9fzbqey0', //'mapbox://styles/tsuho/ckip72uj60c3y17mka9wq9bhh',
        center: defaultPosition,
        zoom: 4.25
    });
    
    //Create the home marker
    let marker = document.createElement("I");
    marker.className = "fa fa-plane-departure marker";
    const homeMarker = new mapboxgl.Marker(marker)
    homeMarker.setDraggable(true);
    homeMarker.on("dragend", (e) => {
        console.log("Home marker position changed");
        getLocationFromGPS(e.target._lngLat.lng, e.target._lngLat.lat).then(res => {
            homeMarkerLoc = res;
            window.localStorage.homeMarker = JSON.stringify({ loc: homeMarkerLoc, ...e.target._lngLat });
            updateHomeMarkerLoc(homeMarkerLoc);
            showShippingInfo(homeMarkerLoc, destMarkerLoc, packageDetails);
        });
    });

    //Create the destination marker
    marker = document.createElement("I");
    marker.className = "fa fa-plane-arrival marker";
    const destMarker = new mapboxgl.Marker(marker);
    destMarker.setDraggable(true);
    destMarker.on("dragend", (e) => {
        console.log("Destination marker position changed");
        getLocationFromGPS(e.target._lngLat.lng, e.target._lngLat.lat).then(res => {
            destMarkerLoc = res;
            window.localStorage.destMarker = JSON.stringify({ loc: destMarkerLoc, ...e.target._lngLat });
            updateDestMarkerLoc(destMarkerLoc);
            showShippingInfo(homeMarkerLoc, destMarkerLoc, packageDetails);
        });
    });

    if (window.localStorage.homeMarker && window.localStorage.destMarker) { //Read markers from memory
        homeMarkerLoc = addMarkerFromMemory(window.localStorage.homeMarker, homeMarker, map);
        destMarkerLoc = addMarkerFromMemory(window.localStorage.destMarker, destMarker, map);
        console.log("Read locations from memory: Home:", homeMarkerLoc,"Dest: ", destMarkerLoc);
        updateHomeMarkerLoc(homeMarkerLoc);
        updateDestMarkerLoc(destMarkerLoc);
        map.fitBounds(getBounding(homeMarker, destMarker));
    } else if (navigator.geolocation) { //Check support and ensure markers aren't persisted
        navigator.geolocation.getCurrentPosition((res) => {
            if (res.coords) {
                map.setCenter([res.coords.longitude, res.coords.latitude]);
                updateMarker(homeMarker, [res.coords.longitude, res.coords.latitude], map);
                getLocationFromGPS(res.coords.longitude, res.coords.latitude).then(res => {
                    document.querySelector("#originZipCode").value = res.zipCode;
                    homeMarkerLoc = res;
                });
            }
        });
    }

    if (!destMarkerLoc) {
        console.log("No dest marker - setting default to domestic");
        toggleDomesticInternationalForm(false, true);	
    }
    
    map.on("click", (e) => {
        if (!homeMarker.getLngLat()) { //Home marker not set
            console.log("Updating home marker");
            updateMarker(homeMarker, [e.lngLat.lng, e.lngLat.lat], map);
            getLocationFromGPS(e.lngLat.lng, e.lngLat.lat).then(res => {
                homeMarkerLoc = res;
                window.localStorage.homeMarker = JSON.stringify({ loc: homeMarkerLoc, ...e.lngLat });
                document.querySelector("#originZipCode").value = res.zipCode;
            });
            return;
        } else { //Destination marker not set (or change)
            console.log("Updating dest marker");
            updateMarker(destMarker, [e.lngLat.lng, e.lngLat.lat], map);
            getLocationFromGPS(e.lngLat.lng, e.lngLat.lat).then(res => {
                destMarkerLoc = res;
                window.localStorage.destMarker = JSON.stringify({ loc: destMarkerLoc, ...e.lngLat });
                updateDestMarkerLoc(destMarkerLoc, e.lngLat);
            });
        }
    });


    document.querySelector("#poundsRange").oninput = () => updateRangeValue("poundsRange");
    document.querySelector("#poundsRange").value = packageDetails.pounds;
    updateRangeValue("poundsRange");
    document.querySelector("#ouncesRange").oninput = () => updateRangeValue("ouncesRange");
    document.querySelector("#ouncesRange").value = packageDetails.ounces;
    updateRangeValue("ouncesRange");

    document.querySelector("#lengthInpt").value = packageDetails.length;
    document.querySelector("#widthInpt").value = packageDetails.width;
    document.querySelector("#heightInpt").value = packageDetails.height;
    document.querySelector("#contentValue").value = packageDetails.price;

    setRadio("serviceType", packageDetails.serviceType);
    setRadio("packageType", packageDetails.packageType);
    setRadio("machinable", packageDetails.machinable);


    document.querySelector("#inputForm").onsubmit = (e) => { //Handle form update (set destination/origin and check validity)
        e.preventDefault();
        let data = new FormData(e.target);
        let originLoc = {
            zipCode: data.get("originZipCode"),
            country: "United States",
            countryCode: "US"
        }

        let countryOpt = document.querySelector("#destCountry");
        
        let destLoc = {
            zipCode: data.get("destZipCode"),
            country: data.get("shippingType") == "domestic" ? "United States" : countryOpt.options[countryOpt.selectedIndex].text, //Get the full name of the country
            countryCode: data.get("shippingType") == "domestic" ? "US" : data.get("destCountry")
        }

        packageDetails = {
            pounds: data.get("pounds"),
            ounces: data.get("ounces"),
            length: data.get("length"),
            width: data.get("width"),
            height: data.get("height"),
            price: data.get("contentValue"),
            machinable: data.get("machinable"),
            serviceType: data.get("serviceType"), //ALL, PRIORITY, FIRST CLASS
            packageType: data.get("packageType") //LETTER, LARGEENVELOPE, PACKAGE, FLATRATE, POSTCARD
        }

        window.localStorage.packageDetails = JSON.stringify(packageDetails);

        let p1 = getGPSFromLocation(originLoc).then(loc => {
            if (!loc) {
                alert("Invalid origin zip code");
                return;
            }
            updateMarker(homeMarker, loc, map);
            map.fitBounds(getBounding(homeMarker, destMarker));
        });
        let p2 = getGPSFromLocation(destLoc).then(loc => {
            if (!loc) {
                alert("Invalid destination country or zip code");
                return;
            }
            updateMarker(destMarker, loc, map);
            map.fitBounds(getBounding(homeMarker, destMarker));
        });
        Promise.all([p1, p2]).then(() => {
            showShippingInfo(homeMarkerLoc, destMarkerLoc, packageDetails);
        });
        console.log("Form updated");
    }

    let isDomestic = true;
    document.querySelectorAll(".shippingTypeRadio").forEach(radBtn => { //Set up menu action for toggling between international/domestic
        radBtn.onchange = () => { //Handle form domestic/international switch
            toggleDomesticInternationalForm(isDomestic, false);
            isDomestic = !isDomestic;
        }
    });
}