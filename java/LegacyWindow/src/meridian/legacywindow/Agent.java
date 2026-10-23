package meridian.legacywindow;

import java.lang.instrument.Instrumentation;

/**
 * Gives Minecraft before 1.6 a native LWJGL window on macOS.
 *
 * Those versions draw into an AWT Canvas through Display.setParent, which
 * LWJGL 2 implements on macOS by copying every frame into a CALayer: slow,
 * with red and blue swapped on Apple Silicon, and the window can't be
 * resized. The agent makes setParent create a regular resizable window
 * instead, hides the empty AWT frame, and keeps the Canvas the size of the
 * window, since that's what the game reads its size from.
 */
public final class Agent {

    private Agent(){
    }

    public static void premain(String args, Instrumentation inst){
        inst.addTransformer(new DisplayTransformer());
    }
}
