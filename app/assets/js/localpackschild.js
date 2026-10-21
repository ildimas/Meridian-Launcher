/**
 * Preloaded (--require) into helios-core's download process, which loads the
 * distribution from disk itself: add the local modpacks to it and let vanilla
 * packs through, as the renderer does in distromanager.js.
 */
const { DistributionAPI } = require('helios-core/common')
const { DistributionIndexProcessor } = require('helios-core/dl')
const LocalPacks = require('./localpacks')

LocalPacks.patchDistributionAPI(DistributionAPI)
LocalPacks.patchIndexProcessor(DistributionIndexProcessor)
