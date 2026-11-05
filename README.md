# Tauri-mcsrc 🚀

A high-performance, native desktop port of the original [mcsrc](https://mcsrc.dev) (Minecraft Source Code Viewer). 

## 🎯 What is this tool used for?
**Tauri-mcsrc** is built for **Minecraft modders, reverse engineers, and researchers** who need to read, navigate, and extract the decompiled source code of Minecraft. It provides a local, native desktop environment to browse the game's code, search through thousands of classes, and export the entire source structure to your hard drive. 

## ⚡ Key Differences: Original mcsrc (Web) vs. Tauri-mcsrc (Desktop)

While the original mcsrc is a fantastic web-based tool, this desktop port addresses specific performance and storage bottlenecks:

| Feature | Original mcsrc (Web) | Tauri-mcsrc (This Project) |
| :--- | :--- | :--- |
| **Decompiler Engine** | WebAssembly (WASM) in Browser | **Native JVM** (Java Sidecar + Vineflower) |
| **Decompilation Speed** | Slow (Limited by browser memory) | **~10x Faster** (Multi-threaded, uses all CPU cores) |
| **JAR Storage** | Browser Cache / IndexedDB | **Local Filesystem** (`/jar_files/`) |
| **Offline Usage** | Hard to manage | **Fully Offline** (Once JAR is cached) |
| **Source Export** | Exports only `.java` files (slow) | **Exports complete project** (`net`, `com`, `assets`, `data`) |
| **Architecture** | Pure Web App | UI (React) + Rust Core + Java Sidecar |

> **Use Case:** If you want to quickly read a class, the web version is great. But if you want to **export the entire source code to compile or mod the game**, or if you are tired of browser memory crashes and want native multi-threading speed, Tauri-mcsrc is the solution.

## ✨ Features
- ⚡ **Blazing Fast:** Native Vineflower decompilation using a multi-threaded JVM sidecar.
- 🖥️ **Native Desktop App:** Built with Tauri (Rust) and React (TypeScript). No localhost server required for backend operations.
- 📦 **Offline JAR Caching:** Automatically stores `client.jar` files in a local `jar_files` directory for instant offline loading.
- 📤 **Direct Source Export:** Export fully decompiled source codes directly to any folder on your disk.
- 🎨 **Monaco Editor:** Rich code viewing with syntax highlighting, inheritance visualization, and Find All References.
- 🔌 **IPC Architecture:** Frontend ↔ Rust Core ↔ Java Sidecar via `stdin/stdout`.

## 🏗️ Architecture

~~~text
┌─────────────────────────────────────────────────────────┐
│                  Tauri Application                      │
│                                                         │
│  ┌────────────────┐         ┌──────────────────────┐    │
│  │   WebView      │ invoke  │   Rust Core          │    │
│  │   (React/TS)   │◄───────►│   (tauri commands)   │    │
│  └────────────────┘         └──────────┬───────────┘    │
│                                        │ stdin/stdout   │
│                                        ▼                │
│                             ┌──────────────────────┐    │
│                             │   Java Sidecar       │    │
│                             │   (JVM + Vineflower) │    │
│                             └──────────────────────┘    │
└─────────────────────────────────────────────────────────┘
~~~

## 🛠️ Prerequisites
To build and run this project, you need:
- **Node.js** (v18+)
- **Rust & Cargo** (via rustup)
- **JDK 21+** (For the Java sidecar)
- **Gradle** (Wrapper is included in the `sidecar` folder)

## 🚀 Getting Started (Development)

1. **Clone the repository:**
   ~~~bash
   git clone https://github.com/yourusername/tauri-mcsrc.git
   cd tauri-mcsrc
   ~~~

2. **Install frontend dependencies:**
   ~~~bash
   npm install
   ~~~

3. **Build the Java Sidecar:**
   ~~~bash
   cd sidecar
   # On Windows:
   gradlew.bat shadowJar
   # On Linux/Mac:
   ./gradlew shadowJar
   cd ..
   ~~~

4. **Run the app in development mode:**
   ~~~bash
   npm run tauri dev
   ~~~

## 📦 Building for Production

We have included a custom build script that automatically builds the Java sidecar first, then bundles the Tauri app.

~~~bash
npm run tauri:build
~~~
The installers (MSI / NSIS) will be generated in `src-tauri/target/release/bundle/`.

## 📁 Local Storage
- **JARs:** Cached in `<project_root>/jar_files/`
- **Decompiled Sources:** Cached in `<project_root>/jar_files/sources/<version>/`

## 🙏 Credits
- Original Web App: [FabricMC/mcsrc](https://github.com/FabricMC/mcsrc)
- Decompiler: [Vineflower](https://github.com/Vineflower/vineflower)
- Framework: [Tauri](https://tauri.app/)

---
*Disclaimer: This tool does NOT redistribute any Minecraft code or compiled bytecode. The Minecraft jar is downloaded directly from Mojang's servers to your local machine.*