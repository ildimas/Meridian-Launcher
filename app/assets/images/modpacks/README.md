# Modpack screenshots

Backgrounds for the modpacks in distribution.json. Make a folder named after
the server's `id` and drop screenshots into it (PNG, JPG or WebP):

```
modpacks/
  Fabric-Demo-1.20.4/
    01.png
    02.png
    credits.json      optional
```

While that modpack is selected the launcher shows its screenshots in a random
order, a new one every 30 seconds. Big PNGs are fine: the launcher keeps a
copy sized for the player's screen in its cache, so they load instantly after
the first time.

`credits.json` puts the author on screen, per file or for the whole folder:

```json
{ "01.png": "Ruri", "*": "Meridian team" }
```

Modpacks without a folder here show the Photon Shaders gallery instead
(`../wallpapers/`). A player's own picks (Settings > Appearance > Your
screenshots) or their own photo take precedence over both.
