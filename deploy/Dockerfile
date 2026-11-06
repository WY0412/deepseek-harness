# Runtime for the packed @deepseek-ai/dsh tree. The workflow fills this
# directory with node_modules before docker build. The pool image adds the
# supervisor on top; this image only puts dsh on PATH.
FROM node:24.21.0-bookworm-slim

COPY node_modules /opt/dsh/node_modules
ENV PATH="/opt/dsh/node_modules/.bin:${PATH}"

RUN dsh --version
