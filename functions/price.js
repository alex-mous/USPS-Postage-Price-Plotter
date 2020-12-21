const parseString = require("xml2js").parseString;
const fetch = require("node-fetch");
const { URLSearchParams } = require("url");

const baseUrl = "http://production.shippingapis.com/ShippingAPI.dll"; //Base URL

/**
 * Convert package type into applicable international mail types
 * 
 * @param {Object} weight Weight object of package
 * @returns {Array<string>} Intl types as array
 */
const getIntlType = (weight) => {
    switch (weight.packageType.toUpperCase()) {
        case "LETTER":
            if (weight.ounces <= 3.5 && weight.pounds == 0) return ["LETTER"];
        case "LARGEENVELOPE":
            if (weight.ounces <= 16 && weight.pounds == 0) return ["LARGEENVELOPE", "ENVELOPE"];
        case "PACKAGE":
            if (weight.ounces <= 16 && weight.pounds == 0) return ["PACKAGE"];
        case "ALL":
            if (weight.ounces <= 3.5 && weight.pounds == 0) return ["LETTER", "POSTCARDS", "PACKAGE", "LARGEENVELOPE"];
            else return ["PACKAGE", "LARGEENVELOPE"];
        case "POSTCARD":
            if (weight.ounces <= 3.5 && weight.pounds == 0) return ["POSTCARDS"];
        case "FLATRATE":
            return ["FLATRATE"];
        default:
            return [];
    }
}

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
    let xmlBody = `
<IntlRateV2Request USERID="${process.env.USPS_ID}">
<Revision>2</Revision>`;
    getIntlType(weight).forEach((intlType, i) => {
        xmlBody += `
<Package ID="${i}">
<Pounds>${weight.pounds}</Pounds>
<Ounces>${weight.ounces}</Ounces>
<Machinable>${weight.machinable}</Machinable>
<MailType>${intlType}</MailType>
<ValueOfContents>${weight.price}</ValueOfContents>
<Country>${country}</Country>
<Width>${intlType != "LETTER" && intlType != "LARGEENVELOPE" && intlType != "POSTCARDS" ? weight.width : ""}</Width>
<Length>${intlType != "LETTER" && intlType != "LARGEENVELOPE" && intlType != "POSTCARDS" ? weight.length : ""}</Length>
<Height>${intlType != "LETTER" && intlType != "LARGEENVELOPE" && intlType != "POSTCARDS" ? weight.height : ""}</Height>
</Package>`
    });
    xmlBody += `</IntlRateV2Request>`;
    console.log(xmlBody);
    return new Promise((resolve, reject) => {
        if (xmlBody.length < 95) {
            resolve({
                err: "No valid combinations"
            });
            return;
        }
        getAPIData(apiName, xmlBody).then((res) => {
            if (!res) reject();
            if (res.Error) reject(res.Error);
            if (weight.serviceType.toLowerCase() != "all") {
                res.IntlRateV2Response.Package[0].Service = res.IntlRateV2Response.Package[0].Service.filter((serv) => {
                    return serv.SvcDescription && serv.SvcDescription[0].toLowerCase().includes(weight.serviceType.replace(" ", "-").toLowerCase());
                });
            }
            resolve(res.IntlRateV2Response.Package);
        });
    });
}


/**
 * Convert package type into applicable First Class Mail types and ensure weight is valid
 * 
 * @param {Object} weight Weight object of package
 * @returns {Array<string>} FCM types as array
 */
const getFCMType = (weight) => {
    switch (weight.packageType.toUpperCase()) {
        case "LETTER":
            if (weight.ounces <= 3.5 && weight.pounds == 0) return ["LETTER"];
        case "LARGEENVELOPE":
            if (weight.ounces <= 13 && weight.pounds == 0) return ["FLAT"];
        case "PACKAGE":
            if (weight.ounces <= 13 && weight.pounds == 0)return ["PACKAGE SERVICE RETAIL"];
        case "ALL":
            if (weight.ounces <= 3.5 && weight.pounds == 0) return ["LETTER", "FLAT", "POSTCARD", "PACKAGE SERVICE RETAIL"];
            else if (weight.ounces <= 13 && weight.pounds == 0) return ["FLAT", "PACKAGE SERVICE RETAIL"];
        case "POSTCARD":
            if (weight.ounces <= 3.5 && weight.pounds == 0) return ["POSTCARD"];
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
        getFCMType(weight).forEach((fcmType) => {
            packages.push({
                ...weight,
                serviceType: "FIRST CLASS",
                firstClassMailType: fcmType,
                container: "VARIABLE"
            });
        });
    } else if (weight.serviceType.toUpperCase() == "PRIORITY") {
        ["Priority", "Priority Mail Express"].forEach((servType) => {
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
                } else {
                    packages.push({
                        ...weight,
                        serviceType: servType,
                        firstClassMailType: "",
                        machinable: "",
                        container: "VARIABLE"
                    });
                }
            } else {
                if (servType == "First Class") {
                    getFCMType(weight).forEach((fcmType) => {
                        packages.push({
                            ...weight,
                            serviceType: servType,
                            packageType: "",
                            firstClassMailType: fcmType,
                            container: "VARIABLE"
                        });
                    })
                } else {
                    packages.push({
                        ...weight,
                        serviceType: servType,
                        firstClassMailType: "",
                        container: "VARIABLE"
                    });
                }
            }
        });
    }

    console.log(packages);
    let xmlBody = `<RateV4Request USERID="${process.env.USPS_ID}"><Revision>2</Revision>`;
    packages.forEach((pkg, i) => {
        xmlBody += `
<Package ID="${i}">
<Service>${pkg.serviceType}</Service>
<FirstClassMailType>${pkg.firstClassMailType}</FirstClassMailType>
<ZipOrigination>${zipStart}</ZipOrigination>
<ZipDestination>${zipEnd}</ZipDestination>
<Pounds>${pkg.pounds}</Pounds>
<Ounces>${pkg.ounces}</Ounces>
<Container>${pkg.container}</Container>
<Width>${pkg.packageType.toUpperCase() != "LETTER" && pkg.packageType.toUpperCase() != "POSTCARD" ? pkg.width : ""}</Width>
<Length>${pkg.packageType.toUpperCase() != "LETTER" && pkg.packageType.toUpperCase() != "POSTCARD" ? pkg.length : ""}</Length>
<Height>${pkg.packageType.toUpperCase() != "LETTER" && pkg.packageType.toUpperCase() != "POSTCARD" ? pkg.height : ""}</Height>
<Value>${pkg.price}</Value>
<Machinable>${pkg.machinable}</Machinable>
<ReturnServiceInfo>TRUE</ReturnServiceInfo>
</Package>`
    });
    xmlBody += "</RateV4Request>";
    console.log(xmlBody);
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
