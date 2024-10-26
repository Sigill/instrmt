FROM debian:bookworm

RUN apt update
RUN apt install -y wget build-essential cmake ccache git ninja-build expect libstring-shellquote-perl rsync

RUN bash -c "$(wget -O - https://deb.nodesource.com/setup_23.x)"
RUN apt-get install nodejs -y

RUN wget -qO- https://apt.llvm.org/llvm-snapshot.gpg.key | tee /etc/apt/trusted.gpg.d/apt.llvm.org.asc
RUN echo "deb http://apt.llvm.org/bookworm/ llvm-toolchain-bookworm-19 main" > /etc/apt/sources.list.d/llvm.list
RUN apt update
RUN apt install -y clang-19

RUN /usr/sbin/update-ccache-symlinks

COPY step /usr/local/bin/step

ENV PATH="/usr/lib/ccache:${PATH}"

ENV CCACHE_DIR=/cache/ccache

RUN mkdir -p /src

WORKDIR /src
