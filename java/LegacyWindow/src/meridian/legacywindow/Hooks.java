package meridian.legacywindow;

import java.awt.Canvas;
import java.awt.EventQueue;
import java.awt.Toolkit;
import java.awt.Window;
import java.awt.event.WindowEvent;

import javax.swing.SwingUtilities;

import org.lwjgl.LWJGLException;
import org.lwjgl.opengl.Display;
import org.lwjgl.opengl.DisplayMode;

/**
 * Called from the patched Display (DisplayTransformer). Public for it.
 */
public final class Hooks {

    /** The game's Canvas, which it reads the window size from. */
    private static Canvas canvas;
    /** The AWT frame around it, hidden. */
    private static volatile Window window;

    private Hooks(){
    }

    /**
     * Instead of drawing into the Canvas, open a native window of its size.
     *
     * @return The parent for Display: none.
     */
    public static Canvas setParent(Canvas parent){
        if(parent == null){
            return null;
        }
        canvas = parent;
        try {
            if(!Display.isFullscreen()){
                int width = parent.getWidth();
                int height = parent.getHeight();
                Display.setDisplayMode(new DisplayMode(width > 0 ? width : 854, height > 0 ? height : 480));
            }
            Display.setResizable(true);
        } catch(LWJGLException e) {
            e.printStackTrace();
        }
        EventQueue.invokeLater(new Runnable(){
            @Override
            public void run(){
                Window w = SwingUtilities.getWindowAncestor(parent);
                if(w != null){
                    w.setVisible(false);
                    window = w;
                }
            }
        });
        System.out.println("[LegacyWindow] Using a native window instead of the AWT canvas");
        return null;
    }

    /**
     * Each frame: resize the Canvas with the window, so the game sees the new
     * size, and pass the close button on to the frame, whose listener stops
     * the game (with a Canvas the game doesn't check Display.isCloseRequested).
     */
    public static void update(){
        if(canvas == null || !Display.isCreated()){
            return;
        }
        if(Display.isCloseRequested()){
            Window w = window;
            if(w != null){
                // Posted, not dispatched: the listener joins this thread.
                Toolkit.getDefaultToolkit().getSystemEventQueue().postEvent(new WindowEvent(w, WindowEvent.WINDOW_CLOSING));
            }
        }
        if(Display.isFullscreen()){
            return;
        }
        int width = Display.getWidth();
        int height = Display.getHeight();
        if(width > 0 && height > 0 && (width != canvas.getWidth() || height != canvas.getHeight())){
            canvas.setSize(width, height);
        }
    }
}
