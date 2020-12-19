const parseString = require("xml2js").parseString;
const https = require("https");
const http = require("http");
const express = require("express");
const fetch = require("node-fetch");
const fs = require("fs");
const { URLSearchParams } = require("url");

const config = require("./config.json");

const baseUrl = "http://production.shippingapis.com/ShippingAPI.dll"; //Base URL
const HTTPS_PORT = "443"; //Web port for HTTPS server
const HTTP_PORT = "80"; //Web port for HTTP redirect
const HOST_NAME = "0.0.0.0";

const app = express();

let sslOpts = { //SSL for PWA installation
	key: fs.readFileSync(config.KEY_FILE),
	cert: fs.readFileSync(config.CRT_FILE),
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
    if (weight.serviceType.toUpperCase() == "FIRST CLASS" || weight.packageType.toUpperCase() == "POSTCARD") {
        switch (weight.packageType.toUpperCase()) {
            case "LETTER":
                firstClassMailType = weight.packageType;
                machinable = weight.machinable;
                break;
            case "POSTCARD":
                firstClassMailType = weight.packageType;
                weight.serviceType = "FIRST CLASS"; //Postcards on FCM only
                break;
            case "LARGEENVELOPE":
                firstClassMailType = "FLAT";
                break;
            case "PACKAGE":
                firstClassMailType = "PACKAGE SERVICE RETAIL";
                break;
        }
        weight.packageType = ""; //Reset package type
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

/* Web Server */
app.use(express.static("public"));

app.use(express.json());

//Redirect GET requests to home page
app.get("*", (_, res) => {
    res.redirect("/index.html");
});

//API POST request
app.post("/api/:method", (req, res) => {
    if (req.params.method.toLowerCase() == "price") { //price request
        switch (req.body.type.toLowerCase()) {
            case "international": //International
                getInternationalPrice(req.body.country, req.body.weight)
                    .then((resp) => {
                        res.status(200).end(JSON.stringify(resp));
                    });
                break;
            case "domestic":
                getDomesticPrice(req.body.zipStart, req.body.zipEnd, req.body.weight)
                    .then((resp) => {
                        res.status(200).end(JSON.stringify(resp));
                    });
                break;
            default:
                res.sendStatus(401);
        }
    }
});

https.createServer(sslOpts, app).listen(HTTPS_PORT, HOST_NAME, () => { //Create HTTPS server
	console.log(`App listening on port ${HTTPS_PORT}`);
});

//Redirect HTTP to HTTPS server
http.createServer((req, res) => {
    res.writeHead(301, {
        "Location": `https://${req.headers.host}`
    });
    res.end();
}).listen(HTTP_PORT, HOST_NAME, () => {
    console.log(`Redirector listening on port ${HTTP_PORT}`);
});