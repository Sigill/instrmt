FROM debian:bullseye

RUN apt-get update && apt-get install -y wget build-essential cmake ccache git ninja-build
RUN wget -qO- https://deb.nodesource.com/setup_16.x | bash - && apt-get install -y nodejs
RUN echo "deb http://apt.llvm.org/bullseye/ llvm-toolchain-bullseye-12 main" >> /etc/apt/sources.list.d/llvm.list && wget -O - https://apt.llvm.org/llvm-snapshot.gpg.key | apt-key add - && apt-get update && apt-get -y install clang-12
RUN apt-get install -y expect libstring-shellquote-perl

RUN /usr/sbin/update-ccache-symlinks

COPY step /usr/local/bin/step

ENV PATH="/usr/lib/ccache:${PATH}"

ENV CCACHE_DIR=/cache/ccache

RUN mkdir -p /src

WORKDIR /src
