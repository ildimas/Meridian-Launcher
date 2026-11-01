# NeoForge packs from Nebula

Remote packs use the version manifest published by Nebula. Launch behavior is
selected from the manifest and module declarations, rather than a pack name or
a fixed NeoForge version:

- NeoForge coordinates and `neoforge-*` version manifests identify the runtime
  version, including beta versions. The loader's bootstrap-library version is
  independent of the NeoForge version.
- Missing modern NeoForge `universal` jars are added as runtime dependencies
  outside the Java classpath. Publisher-provided jars retain their URL, path
  and checksum. Maven metadata is cached for subsequent offline launches.
- Legacy NeoForge for Minecraft 1.20.1 retains its `net.neoforged:forge` layout.
- BootstrapLauncher excludes the vanilla Minecraft jar from the classpath;
  `net.neoforged.fml.startup.Client` includes it.
- JVM and game arguments accept strings and conditional string/list values.
  OS name, version, architecture and feature conditions are evaluated in order;
  the last matching rule decides. Known placeholders are expanded in each
  selected string, with `;` as the Windows classpath separator and `:` on Unix.
  Launching does not modify the downloaded manifests.

Publish the full client runtime and a matching version manifest, with Java
requirements appropriate to the Minecraft version. The launcher cannot infer
arbitrary missing mods, processor outputs or other publisher-specific files.

## Windows virtual machines and OpenGL

`Failed to find a valid GLFW profile`, followed by
`WGL: The driver does not appear to support OpenGL`, indicates a failure to
create a graphics context. Re-downloading the pack or changing its NeoForge
version does not supply the missing graphics support.

Check the virtual graphics adapter, install its guest graphics driver/tools,
and enable supported 3D acceleration. The guest must expose the OpenGL version
required by the selected Minecraft version. Some VM configurations require GPU
passthrough or a different graphics backend. Test on physical Windows hardware
to distinguish launcher compatibility from VM graphics limitations.

References: [GLFW WGL implementation](https://github.com/glfw/glfw/blob/master/src/wgl_context.c)
and [Minecraft's OpenGL 3.2 core-profile requirement](https://www.minecraft.net/en-us/article/minecraft-snapshot-21w10a).

`node --test test/neoforge.test.js` checks runtime completion, both entrypoints,
metadata validation/offline caching and launch arguments with simulated Windows,
macOS and Linux platforms. These checks do not replace actual game launches on
those operating systems or validate a VM's graphics driver.
