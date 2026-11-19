# The base is keyed by the normalized vendor dependency tree and immutable
# Node image digest. It changes only when either input changes.
ARG NODE_BASE_IMAGE
FROM ${NODE_BASE_IMAGE} AS runtime-base

COPY base/node_modules /opt/dsh/node_modules
ENV PATH="/opt/dsh/node_modules/.bin:${PATH}"

# The final image overlays only packages built by this repository. The runtime
# inventory remains a CI artifact and is deliberately not copied into either
# image.
ARG DSH_RUNTIME_BASE_IMAGE
FROM ${DSH_RUNTIME_BASE_IMAGE} AS final

COPY app/node_modules /opt/dsh/node_modules
ENV PATH="/opt/dsh/node_modules/.bin:${PATH}"

RUN dsh --version
