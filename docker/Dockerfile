FROM debian:stable

RUN apt-get update && apt-get install -y build-essential cmake ccache git ninja-build
RUN apt-get install -y wget && wget -qO- https://deb.nodesource.com/setup_15.x | bash - && apt-get install -y nodejs

RUN /usr/sbin/update-ccache-symlinks

ENV PATH="/usr/lib/ccache:${PATH}"

ENV CCACHE_DIR=/cache/ccache

RUN mkdir -p /src /cache/ccache /cache/node_modules /cache/vendor

WORKDIR /src
