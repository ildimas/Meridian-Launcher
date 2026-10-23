#!/bin/sh
# Builds libraries/java/LegacyWindow.jar, the Java agent processbuilder.js
# adds for Minecraft before 1.6 on macOS (see src/.../Agent.java).
# Needs a JDK 11+ (javac, java). The jar is committed: run this after
# changing the sources.
set -eu

cd "$(dirname "$0")"
OUT=../../libraries/java/LegacyWindow.jar
WORK=build
DEPS=$WORK/deps

# file, sha1, url
fetch(){
    if [ ! -f "$DEPS/$1" ] || [ "$(shasum -a 1 "$DEPS/$1" | cut -d' ' -f1)" != "$2" ]; then
        curl -sfL -o "$DEPS/$1" "$3"
        [ "$(shasum -a 1 "$DEPS/$1" | cut -d' ' -f1)" = "$2" ] || { echo "Bad checksum: $1" >&2; exit 1; }
    fi
}

rm -rf "$WORK/classes" "$WORK/tools" "$WORK/agent.jar"
mkdir -p "$DEPS" "$WORK/classes" "$WORK/tools"

fetch asm-9.7.jar 073d7b3086e14beb604ced229c302feff6449723 \
    https://repo1.maven.org/maven2/org/ow2/asm/asm/9.7/asm-9.7.jar
fetch asm-commons-9.7.jar e86dda4696d3c185fcc95d8d311904e7ce38a53f \
    https://repo1.maven.org/maven2/org/ow2/asm/asm-commons/9.7/asm-commons-9.7.jar
# Compile only: the game brings its own LWJGL.
fetch lwjgl-2.9.4-nightly-20150209.jar 697517568c68e78ae0b4544145af031c81082dfe \
    https://libraries.minecraft.net/org/lwjgl/lwjgl/lwjgl/2.9.4-nightly-20150209/lwjgl-2.9.4-nightly-20150209.jar

javac --release 8 -nowarn -d "$WORK/classes" \
    -cp "$DEPS/asm-9.7.jar:$DEPS/lwjgl-2.9.4-nightly-20150209.jar" \
    $(find src -name '*.java')
jar cf "$WORK/agent.jar" -C "$WORK/classes" .

javac -d "$WORK/tools" -cp "$DEPS/asm-9.7.jar:$DEPS/asm-commons-9.7.jar" tools/Relocate.java
java -cp "$WORK/tools:$DEPS/asm-9.7.jar:$DEPS/asm-commons-9.7.jar" Relocate \
    "$OUT" MANIFEST.MF "$WORK/agent.jar" "$DEPS/asm-9.7.jar"

jar uf "$OUT" LICENSE-ASM.txt

echo "Built $OUT"
