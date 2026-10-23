package meridian.legacywindow;

import java.lang.instrument.ClassFileTransformer;
import java.security.ProtectionDomain;

import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassVisitor;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.MethodVisitor;
import org.objectweb.asm.Opcodes;

/**
 * Calls Hooks at the start of Display.setParent, which then gets the Canvas
 * Hooks returns (null), and of Display.update.
 */
final class DisplayTransformer implements ClassFileTransformer {

    private static final String DISPLAY = "org/lwjgl/opengl/Display";
    private static final String HOOKS = "meridian/legacywindow/Hooks";

    @Override
    public byte[] transform(ClassLoader loader, String name, Class<?> redefined, ProtectionDomain domain, byte[] bytes){
        if(!DISPLAY.equals(name)){
            return null;
        }
        try {
            ClassReader reader = new ClassReader(bytes);
            ClassWriter writer = new ClassWriter(reader, ClassWriter.COMPUTE_MAXS);
            reader.accept(new ClassVisitor(Opcodes.ASM9, writer){
                @Override
                public MethodVisitor visitMethod(int access, String method, String desc, String signature, String[] exceptions){
                    MethodVisitor mv = super.visitMethod(access, method, desc, signature, exceptions);
                    if("setParent".equals(method) && "(Ljava/awt/Canvas;)V".equals(desc)){
                        return new MethodVisitor(Opcodes.ASM9, mv){
                            @Override
                            public void visitCode(){
                                super.visitCode();
                                super.visitVarInsn(Opcodes.ALOAD, 0);
                                super.visitMethodInsn(Opcodes.INVOKESTATIC, HOOKS, "setParent", "(Ljava/awt/Canvas;)Ljava/awt/Canvas;", false);
                                super.visitVarInsn(Opcodes.ASTORE, 0);
                            }
                        };
                    }
                    if("update".equals(method) && "(Z)V".equals(desc)){
                        return new MethodVisitor(Opcodes.ASM9, mv){
                            @Override
                            public void visitCode(){
                                super.visitCode();
                                super.visitMethodInsn(Opcodes.INVOKESTATIC, HOOKS, "update", "()V", false);
                            }
                        };
                    }
                    return mv;
                }
            }, 0);
            System.out.println("[LegacyWindow] Patched " + name);
            return writer.toByteArray();
        } catch(Throwable t) {
            System.err.println("[LegacyWindow] Failed to patch " + name);
            t.printStackTrace();
            return null;
        }
    }
}
