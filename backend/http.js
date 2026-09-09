/**
 * The one HTTP client for upstream feeds. Every source used to call axios
 * raw with its own timeout and no User-Agent except NOAA; this gives them
 * one identity (NOAA asks for contact info in the UA), one default timeout,
 * gzip, and a size cap. Per-call options still override.
 */

const axios = require('axios');
const pkg = require('./package.json');

const USER_AGENT = process.env.USER_AGENT
  || `(HazardPulse/${pkg.version}, github.com/abontherun-lang/hazardpulse)`;

const http = axios.create({
  timeout: 15000,
  headers: { 'User-Agent': USER_AGENT, 'Accept-Encoding': 'gzip, deflate' },
  maxContentLength: 100 * 1024 * 1024,
  maxBodyLength: 100 * 1024 * 1024
});

module.exports = { http, USER_AGENT };
