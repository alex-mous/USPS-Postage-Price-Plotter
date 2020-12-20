const parseString = require("xml2js").parseString;
const fetch = require("node-fetch");
const { URLSearchParams } = require("url");

const config = require("../config.json");

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
<IntlRateV2Request USERID="${config.USPS_ID}">\
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
            resolve(res.IntlRateV4Response.Package);
        });
    });
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
    let firstClassMailType = ""; //Default to not a FCM type
    let machinable = ""; //Package machinability (First Class Letters ONLY)
    console.log(weight);
    if (weight.serviceType.toUpperCase() == "FIRST CLASS") {
        switch (weight.packageType.toUpperCase()) {
            case "LETTER":
                firstClassMailType = weight.packageType;
                machinable = weight.machinable;
                break;
            case "LARGEENVELOPE":
                firstClassMailType = "FLAT";
                break;
            case "PACKAGE":
                firstClassMailType = "PACKAGE SERVICE RETAIL";
                break;
        }
        weight.packageType = ""; //Reset package type
    } else if (weight.serviceType.toUpperCase() == "ALL") {
        machinable = weight.machinable;
    }
    if (weight.packageType.toUpperCase() == "POSTCARD") {
        firstClassMailType = weight.packageType;
        weight.serviceType = "FIRST CLASS"; //Postcards on FCM only
    }

    
    if (weight.serviceType.toUpperCase() == "PRIORITY") {
        let xmlBody = `\
<RateV4Request USERID="${config.USPS_ID}">\
<Revision>2</Revision>\
<Package ID="1ST">\
<Service>Priority</Service>\
<ZipOrigination>${zipStart}</ZipOrigination>\
<ZipDestination>${zipEnd}</ZipDestination>\
<Pounds>${weight.pounds}</Pounds>\
<Ounces>${weight.ounces}</Ounces>\
<Container></Container>\
<Value>${weight.price}</Value>\
</Package>\
<Package ID="2ND">\
<Service>Priority Mail Express</Service>\
<ZipOrigination>${zipStart}</ZipOrigination>\
<ZipDestination>${zipEnd}</ZipDestination>\
<Pounds>${weight.pounds}</Pounds>\
<Ounces>${weight.ounces}</Ounces>\
<Container></Container>\
<Value>${weight.price}</Value>\
</Package>\
</RateV4Request>`;
        return new Promise((resolve, reject) => {
            getAPIData(apiName, xmlBody).then((res) => {
                if (!res) reject();
                resolve(res.RateV4Response.Package);
            });
        });
    } else {
        let xmlBody = `\
<RateV4Request USERID="${config.USPS_ID}">\
<Revision>2</Revision>\
<Package ID="1ST">\
<Service>${weight.serviceType}</Service>\
<FirstClassMailType>${firstClassMailType}</FirstClassMailType>\
<ZipOrigination>${zipStart}</ZipOrigination>\
<ZipDestination>${zipEnd}</ZipDestination>\
<Pounds>${weight.pounds}</Pounds>\
<Ounces>${weight.ounces}</Ounces>\
<Container></Container>\
<Value>${weight.price}</Value>\
<Machinable>${machinable}</Machinable>\
</Package>\
</RateV4Request>`;
        return new Promise((resolve, reject) => {
            getAPIData(apiName, xmlBody).then((res) => {
                if (!res) reject();
                resolve(res.RateV4Response.Package);
            });
        });
    }
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
    console.log(ev.headers);
    if (ev.headers["content-type"] != "application/json") {
        return {
            statusCode: 400,
            body: JSON.stringify({err:"Cannot parse content type other than JSON"})
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
                        body: JSON.stringify({err:"International requests must include both country string and weight object"})
                    }
                }
                resp = await getInternationalPrice(body.country, body.weight)
            } catch (e) {
                console.log("Error! ", e);
                return {
                    statusCode: 500,
                    body: JSON.stringify({err:"Error in processing request"})
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
                        body: JSON.stringify({err:"Domestic requests must include starting and ending zip strings and weight object"})
                    }
                }
                resp = await getDomesticPrice(body.zipStart, body.zipEnd, body.weight)
            } catch (e) {
                console.log("Error! ", e);
                return {
                    statusCode: 500,
                    body: JSON.stringify({err:"Error in processing request"})
                }
            }
            return {
                statusCode: 200,
                body: JSON.stringify(resp)
            }
        default:
            return {
                statusCode: 400,
                body: JSON.stringify({err:"Type must be either domestic or international"})
            }
    }
}
