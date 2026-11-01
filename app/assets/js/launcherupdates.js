/**
 * New launcher versions for installs a package manager updates (see
 * updatepolicy.js). The launcher can't install them there; it only says a
 * new version is out.
 */
const got    = require('got')
const semver = require('semver')

const { REQUEST_TIMEOUT } = require('./proxyagent')

const RELEASES_URL = 'https://api.github.com/repos/ildimas/Meridian-Launcher/releases?per_page=20'

/**
 * The newest published release above the running version, or null.
 *
 * @param {Object[]} releases Releases from the GitHub API.
 * @param {string} current The running version.
 * @param {boolean} prerelease Whether pre-releases count.
 * @returns {{version: string, url: string} | null}
 */
exports.pickNewer = function(releases, current, prerelease){
    let newest = null
    for(const release of releases){
        const version = semver.valid(semver.clean(String(release.tag_name || '')))
        if(release.draft || version == null || (release.prerelease && !prerelease)){
            continue
        }
        if(semver.gt(version, current) && (newest == null || semver.gt(version, newest.version))){
            newest = { version, url: release.html_url }
        }
    }
    return newest
}

/**
 * Ask GitHub for a release newer than the running version.
 *
 * @param {string} current The running version.
 * @param {boolean} prerelease Whether pre-releases count.
 * @returns {Promise.<{version: string, url: string} | null>}
 */
exports.findNewer = async function(current, prerelease){
    const releases = await got.get(RELEASES_URL, {
        timeout: REQUEST_TIMEOUT,
        retry: { limit: 1 },
        headers: { accept: 'application/vnd.github+json' }
    }).json()
    return exports.pickNewer(releases, current, prerelease)
}
