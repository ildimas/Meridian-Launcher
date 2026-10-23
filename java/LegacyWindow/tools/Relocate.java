import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.jar.JarEntry;
import java.util.jar.JarInputStream;
import java.util.jar.JarOutputStream;
import java.util.jar.Manifest;

import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.commons.ClassRemapper;
import org.objectweb.asm.commons.Remapper;

/**
 * Relocate.java <out.jar> <manifest> <in.jar>...
 *
 * Merges the jars into one, moving ASM to meridian/legacywindow/asm, so the
 * agent's ASM can't clash with the one the game has on its classpath.
 */
public class Relocate {

    private static final String FROM = "org/objectweb/asm/";
    private static final String TO = "meridian/legacywindow/asm/";

    public static void main(String[] args) throws Exception {
        Remapper remapper = new Remapper(){
            @Override
            public String map(String name){
                return name.startsWith(FROM) ? TO + name.substring(FROM.length()) : name;
            }
        };
        Manifest manifest;
        try(InputStream in = Files.newInputStream(Paths.get(args[1]))){
            manifest = new Manifest(in);
        }
        try(OutputStream os = Files.newOutputStream(Paths.get(args[0])); JarOutputStream out = new JarOutputStream(os, manifest)){
            for(int i = 2; i < args.length; i++){
                try(JarInputStream in = new JarInputStream(Files.newInputStream(Paths.get(args[i])))){
                    for(JarEntry entry; (entry = in.getNextJarEntry()) != null;){
                        String name = entry.getName();
                        if(!name.endsWith(".class") || name.endsWith("module-info.class")){
                            continue;
                        }
                        ClassReader reader = new ClassReader(in.readAllBytes());
                        ClassWriter writer = new ClassWriter(0);
                        reader.accept(new ClassRemapper(writer, remapper), 0);
                        out.putNextEntry(new JarEntry(remapper.map(name.substring(0, name.length() - 6)) + ".class"));
                        out.write(writer.toByteArray());
                        out.closeEntry();
                    }
                }
            }
        }
    }
}
