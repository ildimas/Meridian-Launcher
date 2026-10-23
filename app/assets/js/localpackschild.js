/**
 * Preloaded (--require) into helios-core's download process, which loads the
 * distribution from disk itself: add the local modpacks to it and let vanilla
 * packs through, as the renderer does in distromanager.js. Old Minecraft
 * versions are validated here too, so heliosfixes.js applies as well.
 */
const { DistributionAPI, HeliosModule } = require('helios-core/common')
const { DistributionIndexProcessor, MojangIndexProcessor } = require('helios-core/dl')
const HeliosFixes = require('./heliosfixes')
const LocalPacks = require('./localpacks')

LocalPacks.patchDistributionAPI(DistributionAPI)
LocalPacks.patchIndexProcessor(DistributionIndexProcessor)
HeliosFixes.patchMojangIndexProcessor(MojangIndexProcessor)
HeliosFixes.patchHeliosModule(HeliosModule)
