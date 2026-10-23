/**
 * Preloaded (--require) into helios-core's download process, like
 * proxychild.js. helios-core downloads 15 files at a time; big packs are
 * thousands of small files, where the time goes to round trips, not bytes,
 * so more at once makes them much faster.
 */
const { createRequire } = require('module')

// Files downloaded at once.
const DOWNLOADS = 32

// The fastq helios-core itself loads, patched before it does.
const fastq = createRequire(require.resolve('helios-core'))('fastq')
const promise = fastq.promise
fastq.promise = function(...args){
    // Only DownloadEngine's queue: promise(worker, 15).
    if(args.length === 2 && typeof args[0] === 'function' && args[1] === 15){
        args[1] = DOWNLOADS
    }
    return promise.apply(this, args)
}
