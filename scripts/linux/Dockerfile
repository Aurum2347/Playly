# Окружение для сборки Playly под Linux (Ubuntu 22.04 — сборка запустится и на более новых дистрибутивах).
# Используется скриптом scripts/build-linux.mjs (npm run build:linux).
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
# linuxdeploy (сборщик AppImage) сам — AppImage, а FUSE в контейнере нет: пусть распаковывается и запускается так
ENV APPIMAGE_EXTRACT_AND_RUN=1

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl wget file git build-essential pkg-config xdg-utils rpm patchelf \
      libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libssl-dev libxdo-dev \
      # GStreamer: WebKitGTK играет звук через него, AppImage забирает плагины себе (bundleMediaFramework)
      gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-libav \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable
ENV PATH=/root/.cargo/bin:$PATH

WORKDIR /build
