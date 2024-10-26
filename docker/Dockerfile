FROM debian:bookworm

RUN apt update
RUN apt install -y wget build-essential cmake ccache git ninja-build expect libstring-shellquote-perl rsync
RUN bash -c "$(wget -O - https://deb.nodesource.com/setup_23.x)"
RUN apt-get install nodejs -y

# RUN apt install -y lsb-release wget software-properties-common gnupg
# RUN wget -O /tmp/llvm.sh https://apt.llvm.org/llvm.sh
# RUN bash /tmp/llvm.sh 19

RUN /usr/sbin/update-ccache-symlinks

COPY step /usr/local/bin/step

ENV PATH="/usr/lib/ccache:${PATH}"

ENV CCACHE_DIR=/cache/ccache

RUN mkdir -p /src

WORKDIR /src
