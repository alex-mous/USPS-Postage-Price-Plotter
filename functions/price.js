const parseString = require("xml2js").parseString;
const fetch = require("node-fetch");
const { URLSearchParams } = require("url");

const baseUrl = "http://production.shippingapis.com/ShippingAPI.dll"; //Base URL

/**
 * Get the price based on a country
 * 
 * @param {string} country Country name
 * @param {Object} weight Weight options
 * @async
 * @returns {Object} International rate request object
 */
const getInternationalPrice = (country, weight) => {
    let apiName = "IntlRateV2"; //Name of API
    //Request body
    let xmlBody = `\
<IntlRateV2Request USERID="${process.env.USPS_ID}">\
<Revision>2</Revision>\
<Package ID="1ST">\
<Pounds>${weight.pounds}</Pounds>\
<Ounces>${weight.ounces}</Ounces>\
<MailType>${weight.packageType}</MailType>\
<ValueOfContents>${weight.price}</ValueOfContents>\
<Country>${country}</Country>\
<Container />\
<Size>REGULAR</Size>\
</Package>\
</IntlRateV2Request>`;
    return new Promise((resolve, reject) => {
        getAPIData(apiName, xmlBody).then((res) => {
            if (!res) reject();
            if (res.Error) reject(res.Error);
            resolve(res.IntlRateV2Response.Package);
        });
    });
}


/**
 * Convert package type into applicable First Class Mail types
 * 
 * @param {string} pkgType Package type name
 * @returns {Array<string>} FCM types as array
 */
const getFCMType = (pkgType) => {
    switch (pkgType.toUpperCase()) {
        case "LETTER":
            return ["LETTER"];
        case "LARGEENVELOPE":
            return ["FLAT"];
        case "PACKAGE":
            return ["PACKAGE SERVICE RETAIL"];
        case "ALL":
            return ["LETTER", "FLAT", "POSTCARD", "PACKAGE SERVICE RETAIL"];
        case "POSTCARD":
            return ["POSTCARD"];
        default:
            return [];
    }
}

/**
 * Get the price based on a starting and destination zip code
 * 
 * @param {string} zipStart Origin zip code
 * @param {string} zipEnd Destination zip code
 * @param {Object} weight Weight options
 * @async
 * @returns {Object} Domestic rate request object
 */
const getDomesticPrice = (zipStart, zipEnd, weight) => {
    let apiName = "RateV4"; //Name of API

    let packages = []; //Store multiple requests

    if (weight.serviceType.toUpperCase() == "FIRST CLASS" || weight.packageType.toUpperCase() == "POSTCARD") {
        getFCMType(weight.packageType).forEach((fcmType) => {
            packages.push({
                ...weight,
                firstClassMailType: fcmType,
                container: "VARIABLE"
            });
        });
    } else if (weight.serviceType.toUpperCase() == "PRIORITY") {
        ["Priority", "Priority Mail Express"].forEach((servType) => {
            if (weight.packageType.toUpperCase() == "FLATRATE") {
                ["FLAT RATE ENVELOPE", "PADDED FLAT RATE ENVELOPE", "LEGAL FLAT RATE ENVELOPE", "SM FLAT RATE ENVELOPE", "WINDOW FLAT RATE ENVELOPE", "GIFT CARD FLAT RATE ENVELOPE", "SM FLAT RATE BOX", "MD FLAT RATE BOX", "LG FLAT RATE BOX"].forEach((flatType) => {
                    packages.push({
                        ...weight,
                        serviceType: servType,
                        firstClassMailType: "",
                        machinable: "",
                        container: flatType
                    });
                });
            } else {
                packages.push({
                    ...weight,
                    serviceType: servType,
                    firstClassMailType: "",
                    machinable: "",
                    container: "VARIABLE"
                });
            }
        });
    } else if (weight.serviceType.toUpperCase() == "ALL") { //Available Types: First Class, Priority, Priority Mail Express, Retail Ground, Parcel Select Ground, Media
        ["First Class", "Priority", "Priority Mail Express", "Retail Ground", "Parcel Select Ground", "Media"].forEach((servType) => {
            if (servType.startsWith("Priority")) { //Only applicable to priority services
                if (weight.packageType.toUpperCase() == "FLATRATE" || weight.packageType.toUpperCase() == "ALL") {
                    ["FLAT RATE ENVELOPE", "PADDED FLAT RATE ENVELOPE", "LEGAL FLAT RATE ENVELOPE", "SM FLAT RATE ENVELOPE", "WINDOW FLAT RATE ENVELOPE", "GIFT CARD FLAT RATE ENVELOPE", "SM FLAT RATE BOX", "MD FLAT RATE BOX", "LG FLAT RATE BOX"].forEach((flatType) => {
                        packages.push({
                            ...weight,
                            serviceType: servType,
                            firstClassMailType: "",
                            machinable: "",
                            container: flatType
                        });
                    });
                }
            } else {
                if (servType == "First Class") {
                    getFCMType(weight.packageType).forEach((fcmType) => {
                        packages.push({
                            ...weight,
                            serviceType: servType,
                            firstClassMailType: fcmType,
                            container: "VARIABLE"
                        });
                    })
                } else {
                    packages.push({
                        ...weight,
                        serviceType: servType,
                        machinable: "",
                        container: "VARIABLE"
                    });
                }
            }
        });
    }

    console.log(packages);
    let xmlBody = `<RateV4Request USERID="${process.env.USPS_ID}"><Revision>2</Revision>`;
    packages.forEach((pkg) => {
        xmlBody += `\
<Package ID="1">\
<Service>${pkg.serviceType}</Service>\
<FirstClassMailType>${pkg.firstClassMailType}</FirstClassMailType>\
<ZipOrigination>${zipStart}</ZipOrigination>\
<ZipDestination>${zipEnd}</ZipDestination>\
<Pounds>${pkg.pounds}</Pounds>\
<Ounces>${pkg.ounces}</Ounces>\
<Container>${pkg.container}</Container>\
<Width>${pkg.packageType.toUpperCase() == "PACKAGE" ? pkg.width : ""}</Width>
<Length>${pkg.packageType.toUpperCase() == "PACKAGE" ? pkg.length : ""}</Length>
<Height>${pkg.packageType.toUpperCase() == "PACKAGE" ? pkg.height : ""}</Height>
<Value>${pkg.price}</Value>\
<Machinable>${pkg.machinable}</Machinable>\
<ReturnServiceInfo>TRUE</ReturnServiceInfo>\
</Package>`
    });
    xmlBody += "</RateV4Request>";
    return new Promise((resolve, reject) => {
        if (packages.length == 0) {
            resolve({
                err: "No valid combinations"
            });
            return;
        }
        getAPIData(apiName, xmlBody).then((res) => {
            if (!res) {
                reject();
                return;
            }
            resolve(res.RateV4Response.Package);
        });
    });
}

/**
 * Get the result from the API
 * 
 * @async
 * @param {string} apiName
 * @param {string} xmlReq XML request string
 */
const getAPIData = (apiName, xmlReq) => {
    let params = new URLSearchParams();
    params.append("API", apiName);
    params.append("XML", xmlReq);
    return new Promise((resolve, reject) => {
        fetch(baseUrl, { method: "POST", body: params })
            .then(res => res.text())
            .then(res => parseString(res, (err, result) => {
                if (err) {
                    reject(err);
                } else if (result.Error) {
                    console.log("Ran request: ", xmlReq);
                    console.log("ERR:", result.Error);
                    resolve({err: "Error in request"});
                } else {
                    resolve(result);
                }
            }));
    });
}

exports.handler = async (ev, context) => {
    if (ev.headers["content-type"] != "application/json") {
        return {
            statusCode: 400,
            body: JSON.stringify({
                err: "Cannot parse content type other than JSON"
            })
        }
    }
    let body = JSON.parse(ev.body);
    let resp;
    switch (body.type.toLowerCase()) {
        case "international": //International
            try {
                if (!body.country || !body.weight) {
                    return {
                        statusCode: 400,
                        body: JSON.stringify({
                            err: "International requests must include both country string and weight object"
                        })
                    }
                }
                resp = await getInternationalPrice(body.country, body.weight)
            } catch (e) {
                console.log("Error! ", e);
                return {
                    statusCode: 500,
                    body: JSON.stringify({
                        err: "Error in processing request"
                    })
                }
            }
            return {
                statusCode: 200,
                body: JSON.stringify(resp)
            }
        case "domestic":
            try {
                if (!body.zipStart || !body.zipEnd || !body.weight) {
                    return {
                        statusCode: 400,
                        body: JSON.stringify({
                            err: "Domestic requests must include starting and ending zip strings and weight object"
                        })
                    }
                }
                resp = await getDomesticPrice(body.zipStart, body.zipEnd, body.weight)
            } catch (e) {
                console.log("Error! ", e);
                return {
                    statusCode: 500,
                    body: JSON.stringify({
                        err: "Error in processing request"
                    })
                }
            }
            return {
                statusCode: 200,
                body: JSON.stringify(resp)
            }
        default:
            return {
                statusCode: 400,
                body: JSON.stringify({
                    err: "Type must be either domestic or international"
                })
            }
    }
}
