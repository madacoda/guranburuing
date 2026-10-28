# syntax=docker/dockerfile:1
# ==============================================================================
# Stage 1: Compile Ultra-Lean Native Rust Workspace (`libgbf_core.so` & `gbf-daemon`)
# ==============================================================================
FROM rust:1-slim-bookworm AS rust-builder

WORKDIR /build
COPY Cargo.toml ./
COPY crates ./crates

RUN cargo build --release --workspace

# ==============================================================================
# Stage 2: Production Bun + Headless Chromium Runtime
# ==============================================================================
FROM oven/bun:1.2-slim AS runner

# Install Chromium and required font libraries for headless operation
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libnss3 \
    libatk-bridge2.0-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    CHROME_PATH=/usr/bin/chromium \
    NODE_ENV=production \
    HEADLESS=true \
    PORT=3000 \
    HOST=0.0.0.0

WORKDIR /app

# Copy dependency specifications and lockfile
COPY package.json bun.lock tsconfig.json ./

# Install production dependencies
RUN bun install --frozen-lockfile

# Copy application code, assets, and compiled native Rust shared library + daemon binary
COPY --from=rust-builder /build/target/release/libgbf_core.so ./target/release/libgbf_core.so
COPY --from=rust-builder /build/target/release/gbf-daemon ./target/release/gbf-daemon
COPY src ./src
COPY templates ./templates
COPY public ./public
COPY data ./data

# Create directory structure for artifacts and logs with non-root ownership
RUN mkdir -p artifacts logs /home/bun/.gbf-profiles \
    && chown -R bun:bun /app /home/bun

USER bun

EXPOSE 3000

CMD ["bun", "src/index.ts"]
