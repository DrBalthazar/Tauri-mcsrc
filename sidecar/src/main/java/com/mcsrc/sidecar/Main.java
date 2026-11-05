package com.mcsrc.sidecar;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.jetbrains.java.decompiler.api.Decompiler;
import org.jetbrains.java.decompiler.main.decompiler.DirectoryResultSaver;
import org.jetbrains.java.decompiler.main.extern.IFernflowerLogger;
import org.jetbrains.java.decompiler.main.extern.IFernflowerPreferences;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.File;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

import javax.print.attribute.standard.Severity;

public class Main {
    private static final Gson GSON = new Gson();
    private static final AtomicBoolean running = new AtomicBoolean(true);
    private static BufferedWriter out;

    public static void main(String[] args) throws Exception {
        BufferedReader in = new BufferedReader(
                new InputStreamReader(System.in, StandardCharsets.UTF_8));
        out = new BufferedWriter(
                new OutputStreamWriter(System.out, StandardCharsets.UTF_8));

        log("mcsrc-sidecar started (Vineflower 1.12.0)");

        String line;
        while (running.get() && (line = in.readLine()) != null) {
            if (line.isBlank()) continue;
            try {
                handleRequest(line);
            } catch (Exception e) {
                log("Error handling request: " + e.getMessage());
                e.printStackTrace(System.err);
            }
        }

        log("mcsrc-sidecar shutting down");
    }

    private static void handleRequest(String line) {
        JsonObject request;
        try {
            request = JsonParser.parseString(line).getAsJsonObject();
        } catch (Exception e) {
            log("Invalid JSON: " + line);
            return;
        }

        String id = request.has("id") ? request.get("id").getAsString() : null;
        String cmd = request.has("cmd") ? request.get("cmd").getAsString() : null;

        if (cmd == null) {
            sendError(id, "Missing 'cmd' field");
            return;
        }

        try {
            switch (cmd) {
                case "ping" -> sendResult(id, "pong");
                case "shutdown" -> {
                    sendResult(id, "bye");
                    running.set(false);
                }
                case "version" -> sendResult(id, "0.2.0");
                case "list_classes" -> handleListClasses(id, request);
                case "decompile" -> handleDecompile(id, request);
                default -> sendError(id, "Unknown command: " + cmd);
            }
        } catch (Exception e) {
            sendError(id, e.getMessage());
            e.printStackTrace(System.err);
        }
    }

    private static void handleListClasses(String id, JsonObject request) throws Exception {
        JsonObject params = getParams(request);
        String jarPath = requireString(params, "jarPath");

        File jarFile = new File(jarPath);
        if (!jarFile.exists()) {
            sendError(id, "JAR not found: " + jarPath);
            return;
        }

        List<String> classes = new ArrayList<>();
        try (ZipFile zip = new ZipFile(jarFile)) {
            var entries = zip.entries();
            while (entries.hasMoreElements()) {
                ZipEntry entry = entries.nextElement();
                String name = entry.getName();
                if (name.endsWith(".class")) {
                    classes.add(name.substring(0, name.length() - 6).replace('/', '.'));
                }
            }
        }

        Map<String, Object> result = new HashMap<>();
        result.put("count", classes.size());
        result.put("classes", classes);
        sendResult(id, result);
    }

    private static void handleDecompile(String id, JsonObject request) throws Exception {
        JsonObject params = getParams(request);
        String jarPath = requireString(params, "jarPath");
        String outputDir = requireString(params, "outputDir");

        File jarFile = new File(jarPath);
        if (!jarFile.exists()) {
            sendError(id, "JAR not found: " + jarPath);
            return;
        }

        File outDir = new File(outputDir);
        if (!outDir.exists() && !outDir.mkdirs()) {
            sendError(id, "Could not create output directory: " + outputDir);
            return;
        }

        AtomicInteger processed = new AtomicInteger(0);
        AtomicInteger errors = new AtomicInteger(0);

        final int totalClasses;
        try (ZipFile zip = new ZipFile(jarFile)) {
            int count = 0;
            var entries = zip.entries();
            while (entries.hasMoreElements()) {
                if (entries.nextElement().getName().endsWith(".class")) {
                    count++;
                }
            }
            totalClasses = count;
        }
        log("Total classes to decompile: " + totalClasses);

        IFernflowerLogger logger = new IFernflowerLogger() {
            @Override
            public void writeMessage(String message, Severity severity) {
                if (severity == Severity.ERROR) {
                    errors.incrementAndGet();
                    log("[VF ERROR] " + message);
                } else if (severity == Severity.WARN) {
                    log("[VF WARN] " + message);
                }
            }

            @Override
            public void writeMessage(String message, Severity severity, Throwable t) {
                log("[" + severity + "] " + message + ": " + t.getMessage());
            }

            @Override
            public void startClass(String className) {
                int count = processed.incrementAndGet();
                // فقط هر ۵۰ کلاس یک بار progress بفرست
                if (count % 50 == 0 || count == totalClasses) {
                    sendProgress("decompiling", className, count, totalClasses, errors.get());
                }
            }
        };

        // استفاده از DirectoryResultSaver برای خروجی در پوشه
        DirectoryResultSaver saver = new DirectoryResultSaver(outDir);

        Decompiler decompiler = new Decompiler.Builder()
                .inputs(jarFile)
                .output(saver) // saver به عنوان IResultSaver
                .option(IFernflowerPreferences.DECOMPILE_GENERIC_SIGNATURES, "1")
                .option(IFernflowerPreferences.HIDE_DEFAULT_CONSTRUCTOR, "0")
                .option(IFernflowerPreferences.ASCII_STRING_CHARACTERS, "1")
                .option(IFernflowerPreferences.DECOMPILE_ENUM, "1")
                .option(IFernflowerPreferences.LOG_LEVEL, "warn")
                .option(IFernflowerPreferences.THREADS, String.valueOf(Runtime.getRuntime().availableProcessors()))
                .logger(logger)
                .build();

        decompiler.decompile();

        Map<String, Object> result = new HashMap<>();
        result.put("status", "done");
        result.put("outputDir", outDir.getAbsolutePath());
        result.put("processed", processed.get());
        result.put("errors", errors.get());
        sendResult(id, result);
    }

    private static JsonObject getParams(JsonObject request) {
        return request.has("params") && request.get("params").isJsonObject()
                ? request.getAsJsonObject("params")
                : new JsonObject();
    }

    private static String requireString(JsonObject obj, String key) {
        if (!obj.has(key) || obj.get(key).isJsonNull()) {
            throw new IllegalArgumentException("Missing required param: " + key);
        }
        return obj.get(key).getAsString();
    }

    private static synchronized void sendResult(String id, Object result) {
        JsonObject response = new JsonObject();
        if (id != null) response.addProperty("id", id);
        response.addProperty("ok", true);
        response.add("result", GSON.toJsonTree(result));
        writeLine(response.toString());
    }

    private static synchronized void sendError(String id, String message) {
        JsonObject response = new JsonObject();
        if (id != null) response.addProperty("id", id);
        response.addProperty("ok", false);
        response.addProperty("error", message);
        writeLine(response.toString());
    }

    private static synchronized void sendProgress(
            String stage, String className, int current, int total, int errors) {
        JsonObject notif = new JsonObject();
        notif.addProperty("type", "progress");
        notif.addProperty("stage", stage);
        notif.addProperty("className", className);
        notif.addProperty("current", current);
        notif.addProperty("total", total);
        notif.addProperty("errors", errors);
        writeLine(notif.toString());
    }

    private static synchronized void writeLine(String line) {
        try {
            out.write(line);
            out.write('\n');
            out.flush();
        } catch (Exception e) {
            System.err.println("Failed to write to stdout: " + e.getMessage());
        }
    }

    private static void log(String message) {
        System.err.println("[sidecar] " + message);
        System.err.flush();
    }
}