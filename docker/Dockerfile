FROM debian:bullseye

RUN apt-get update && apt-get install -y wget build-essential cmake ccache git ninja-build expect libstring-shellquote-perl rsync
RUN echo "deb http://apt.llvm.org/bullseye/ llvm-toolchain-bullseye-14 main" >> /etc/apt/sources.list.d/llvm.list && \
    wget -qO- https://apt.llvm.org/llvm-snapshot.gpg.key | apt-key add - && apt-get update && apt-get -y install clang-14
RUN wget -qO- https://deb.nodesource.com/setup_16.x | bash - && apt-get install -y nodejs

RUN /usr/sbin/update-ccache-symlinks

COPY step /usr/local/bin/step

ENV PATH="/usr/lib/ccache:${PATH}"

ENV CCACHE_DIR=/cache/ccache

RUN mkdir -p /src

WORKDIR /src
