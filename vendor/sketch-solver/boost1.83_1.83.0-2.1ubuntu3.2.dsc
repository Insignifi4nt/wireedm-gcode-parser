-----BEGIN PGP SIGNED MESSAGE-----
Hash: SHA512

Format: 3.0 (quilt)
Source: boost1.83
Binary: libboost1.83-dev, libboost1.83-tools-dev, libboost1.83-all-dev, libboost1.83-doc, libboost-atomic1.83.0, libboost-atomic1.83-dev, libboost-chrono1.83.0t64, libboost-chrono1.83-dev, libboost-container1.83.0, libboost-container1.83-dev, libboost-context1.83.0, libboost-context1.83-dev, libboost-contract1.83.0, libboost-contract1.83-dev, libboost-coroutine1.83.0, libboost-coroutine1.83-dev, libboost-date-time1.83.0, libboost-date-time1.83-dev, libboost-exception1.83-dev, libboost-fiber1.83.0, libboost-fiber1.83-dev, libboost-filesystem1.83.0, libboost-filesystem1.83-dev, libboost-graph1.83.0, libboost-graph1.83-dev, libboost-graph-parallel1.83.0, libboost-graph-parallel1.83-dev, libboost-iostreams1.83.0, libboost-iostreams1.83-dev, libboost-locale1.83.0, libboost-locale1.83-dev, libboost-log1.83.0, libboost-log1.83-dev, libboost-math1.83.0, libboost-math1.83-dev, libboost-mpi1.83.0, libboost-mpi1.83-dev, libboost-mpi-python1.83.0, libboost-mpi-python1.83-dev,
 libboost-nowide1.83.0, libboost-nowide1.83-dev, libboost-numpy1.83.0, libboost-numpy1.83-dev, libboost-program-options1.83.0, libboost-program-options1.83-dev, libboost-python1.83.0, libboost-python1.83-dev, libboost-random1.83.0, libboost-random1.83-dev, libboost-regex1.83.0, libboost-regex1.83-dev, libboost-serialization1.83.0, libboost-serialization1.83-dev, libboost-stacktrace1.83.0, libboost-stacktrace1.83-dev, libboost-system1.83.0, libboost-system1.83-dev, libboost-test1.83.0, libboost-test1.83-dev, libboost-thread1.83.0, libboost-thread1.83-dev, libboost-timer1.83.0, libboost-timer1.83-dev, libboost-type-erasure1.83.0, libboost-type-erasure1.83-dev, libboost-wave1.83.0, libboost-wave1.83-dev, libboost-json1.83.0, libboost-json1.83-dev, libboost-url1.83.0,
 libboost-url1.83-dev
Architecture: any all
Version: 1.83.0-2.1ubuntu3.2
Maintainer: Ubuntu Developers <ubuntu-devel-discuss@lists.ubuntu.com>
Uploaders:  Giovanni Mascellani <gio@debian.org>, Anton Gladky <gladk@debian.org>
Homepage: https://www.boost.org/
Standards-Version: 4.6.2
Vcs-Browser: https://salsa.debian.org/debian/boost
Vcs-Git: https://salsa.debian.org/debian/boost.git
Testsuite: autopkgtest
Testsuite-Triggers: build-essential, clang, cmake, html2text, libgraph-easy-perl, mpi-default-dev, python3-minimal
Build-Depends: dpkg-dev (>= 1.22.5), debhelper-compat (= 12), dctrl-tools, chrpath, zlib1g-dev, libbz2-dev, liblzma-dev, libzstd-dev, libicu-dev (>= 63.1), mpi-default-dev [!i386], bison, flex, docbook-to-man, help2man, xsltproc, doxygen, docbook-xsl, docbook-xml, texlive-latex-base, ghostscript, dh-python, g++ (>= 4:5-0), python3, python3-all-dev (>= 3.1), python3-numpy [!i386]
Build-Depends-Indep: graphviz
Build-Conflicts: libopenmpi-dev (= 1.3.2-2)
Package-List:
 libboost-atomic1.83-dev deb libdevel optional arch=any
 libboost-atomic1.83.0 deb libs optional arch=any
 libboost-chrono1.83-dev deb libdevel optional arch=any
 libboost-chrono1.83.0t64 deb libs optional arch=any
 libboost-container1.83-dev deb libdevel optional arch=amd64,arm64,armhf,s390x,ppc64el,riscv64
 libboost-container1.83.0 deb libs optional arch=amd64,arm64,armhf,s390x,ppc64el,riscv64
 libboost-context1.83-dev deb libdevel optional arch=hurd-i386,kfreebsd-i386,amd64,kfreebsd-amd64,armel,armhf,arm64,loong64,mips,mipsel,mips64el,powerpc,ppc64el,riscv64,s390x
 libboost-context1.83.0 deb libs optional arch=hurd-i386,kfreebsd-i386,amd64,kfreebsd-amd64,armel,armhf,arm64,loong64,mips,mipsel,mips64el,powerpc,ppc64el,riscv64,s390x
 libboost-contract1.83-dev deb libdevel optional arch=amd64,arm64,armhf,s390x,ppc64el,riscv64
 libboost-contract1.83.0 deb libs optional arch=amd64,arm64,armhf,s390x,ppc64el,riscv64
 libboost-coroutine1.83-dev deb libdevel optional arch=hurd-i386,kfreebsd-i386,amd64,kfreebsd-amd64,armel,armhf,arm64,loong64,mips,mipsel,mips64el,powerpc,ppc64el,riscv64,s390x
 libboost-coroutine1.83.0 deb libs optional arch=hurd-i386,kfreebsd-i386,amd64,kfreebsd-amd64,armel,armhf,arm64,loong64,mips,mipsel,mips64el,powerpc,ppc64el,riscv64,s390x
 libboost-date-time1.83-dev deb libdevel optional arch=any
 libboost-date-time1.83.0 deb libs optional arch=any
 libboost-exception1.83-dev deb libdevel optional arch=amd64,arm64,armhf,s390x,ppc64el,riscv64
 libboost-fiber1.83-dev deb libdevel optional arch=hurd-i386,kfreebsd-i386,amd64,kfreebsd-amd64,armel,armhf,arm64,loong64,mips,mipsel,mips64el,powerpc,ppc64el,riscv64,s390x
 libboost-fiber1.83.0 deb libs optional arch=hurd-i386,kfreebsd-i386,amd64,kfreebsd-amd64,armel,armhf,arm64,loong64,mips,mipsel,mips64el,powerpc,ppc64el,riscv64,s390x
 libboost-filesystem1.83-dev deb libdevel optional arch=any
 libboost-filesystem1.83.0 deb libs optional arch=any
 libboost-graph-parallel1.83-dev deb libdevel optional arch=amd64,arm64,armhf,s390x,ppc64el,riscv64
 libboost-graph-parallel1.83.0 deb libs optional arch=amd64,arm64,armhf,s390x,ppc64el,riscv64
 libboost-graph1.83-dev deb libdevel optional arch=amd64,arm64,armhf,s390x,ppc64el,riscv64
 libboost-graph1.83.0 deb libs optional arch=amd64,arm64,armhf,s390x,ppc64el,riscv64
 libboost-iostreams1.83-dev deb libdevel optional arch=any
 libboost-iostreams1.83.0 deb libs optional arch=any
 libboost-json1.83-dev deb libdevel optional arch=amd64,arm64,armhf,s390x,ppc64el,riscv64
 libboost-json1.83.0 deb libs optional arch=amd64,arm64,armhf,s390x,ppc64el,riscv64
 libboost-locale1.83-dev deb libdevel optional arch=amd64,arm64,armhf,s390x,ppc64el,riscv64
 libboost-locale1.83.0 deb libs optional arch=amd64,arm64,armhf,s390x,ppc64el,riscv64
 libboost-log1.83-dev deb libdevel optional arch=amd64,arm64,armhf,s390x,ppc64el,riscv64
 libboost-log1.83.0 deb libs optional arch=amd64,arm64,armhf,s390x,ppc64el,riscv64
 libboost-math1.83-dev deb libdevel optional arch=amd64,arm64,armhf,s390x,ppc64el,riscv64
 libboost-math1.83.0 deb libs optional arch=amd64,arm64,armhf,s390x,ppc64el,riscv64
 libboost-mpi-python1.83-dev deb libdevel optional arch=amd64,arm64,armhf,s390x,ppc64el,riscv64
 libboost-mpi-python1.83.0 deb libs optional arch=amd64,arm64,armhf,s390x,ppc64el,riscv64
 libboost-mpi1.83-dev deb libdevel optional arch=amd64,arm64,armhf,s390x,ppc64el,riscv64
 libboost-mpi1.83.0 deb libs optional arch=amd64,arm64,armhf,s390x,ppc64el,riscv64
 libboost-nowide1.83-dev deb libdevel optional arch=amd64,arm64,armhf,s390x,ppc64el,riscv64
 libboost-nowide1.83.0 deb libs optional arch=amd64,arm64,armhf,s390x,ppc64el,riscv64
 libboost-numpy1.83-dev deb libdevel optional arch=amd64,arm64,armhf,s390x,ppc64el,riscv64
 libboost-numpy1.83.0 deb libs optional arch=amd64,arm64,armhf,s390x,ppc64el,riscv64
 libboost-program-options1.83-dev deb libdevel optional arch=amd64,arm64,armhf,s390x,ppc64el,riscv64
 libboost-program-options1.83.0 deb libs optional arch=amd64,arm64,armhf,s390x,ppc64el,riscv64
 libboost-python1.83-dev deb libdevel optional arch=amd64,arm64,armhf,s390x,ppc64el,riscv64
 libboost-python1.83.0 deb libs optional arch=amd64,arm64,armhf,s390x,ppc64el,riscv64
 libboost-random1.83-dev deb libdevel optional arch=amd64,arm64,armhf,s390x,ppc64el,riscv64
 libboost-random1.83.0 deb libs optional arch=amd64,arm64,armhf,s390x,ppc64el,riscv64
 libboost-regex1.83-dev deb libdevel optional arch=any
 libboost-regex1.83.0 deb libs optional arch=any
 libboost-serialization1.83-dev deb libdevel optional arch=any
 libboost-serialization1.83.0 deb libs optional arch=any
 libboost-stacktrace1.83-dev deb libdevel optional arch=amd64,arm64,armhf,s390x,ppc64el,riscv64
 libboost-stacktrace1.83.0 deb libs optional arch=amd64,arm64,armhf,s390x,ppc64el,riscv64
 libboost-system1.83-dev deb libdevel optional arch=any
 libboost-system1.83.0 deb libs optional arch=any
 libboost-test1.83-dev deb libdevel optional arch=any
 libboost-test1.83.0 deb libs optional arch=any
 libboost-thread1.83-dev deb libdevel optional arch=any
 libboost-thread1.83.0 deb libs optional arch=any
 libboost-timer1.83-dev deb libdevel optional arch=amd64,arm64,armhf,s390x,ppc64el,riscv64
 libboost-timer1.83.0 deb libs optional arch=amd64,arm64,armhf,s390x,ppc64el,riscv64
 libboost-type-erasure1.83-dev deb libdevel optional arch=amd64,arm64,armhf,s390x,ppc64el,riscv64
 libboost-type-erasure1.83.0 deb libs optional arch=amd64,arm64,armhf,s390x,ppc64el,riscv64
 libboost-url1.83-dev deb libdevel optional arch=amd64,arm64,armhf,s390x,ppc64el,riscv64
 libboost-url1.83.0 deb libs optional arch=amd64,arm64,armhf,s390x,ppc64el,riscv64
 libboost-wave1.83-dev deb libdevel optional arch=amd64,arm64,armhf,s390x,ppc64el,riscv64
 libboost-wave1.83.0 deb libs optional arch=amd64,arm64,armhf,s390x,ppc64el,riscv64
 libboost1.83-all-dev deb libdevel optional arch=any
 libboost1.83-dev deb libdevel optional arch=any
 libboost1.83-doc deb doc optional arch=all
 libboost1.83-tools-dev deb libdevel optional arch=amd64,arm64,armhf,s390x,ppc64el,riscv64
Checksums-Sha1:
 50759f49cde0e3ca57393c5f97924a536a7ee541 77376520 boost1.83_1.83.0.orig.tar.xz
 7b442972c144d4e1736e5f6e524ec61147c86c78 380048 boost1.83_1.83.0-2.1ubuntu3.2.debian.tar.xz
Checksums-Sha256:
 404df4b4072fc7f2d4483d4fc2d61ff6f554dd80c9a812652684d5952e881c91 77376520 boost1.83_1.83.0.orig.tar.xz
 2928da323658936427908c055a9f5f2eddb1a48d60a58d6e161985d36abdc5dc 380048 boost1.83_1.83.0-2.1ubuntu3.2.debian.tar.xz
Files:
 a1b3cc03203ed69baca9c8b5c62a1585 77376520 boost1.83_1.83.0.orig.tar.xz
 4d6d1451f7f166468095ff33b23de7cf 380048 boost1.83_1.83.0-2.1ubuntu3.2.debian.tar.xz
Original-Maintainer: Debian Boost Team <team+boost@tracker.debian.org>

-----BEGIN PGP SIGNATURE-----

iQIzBAEBCgAdFiEEkpeKbhleSSGCX3/w808JdE6fXdkFAmk9SB0ACgkQ808JdE6f
Xdk0aRAAyhKCuh2ggAIbp5blGwGfI0oQkj8RTAmsHWj6lXj9urT/Bqn9IRdAfRrL
4/qm3nC9KMTIY/NOTqQOxxNwW9Bkjz3EVmWoiTzVbpQv2NgYadeW6JMqHZsphew6
CXIZDGdXT3USfz6j0GTzbJ1iXwyE77SrAreUtHd6dMlfCl/uDMVqPim3zkfiiQhf
gl0vAyty/l4PjbfCdybPRNKD82oHP3huKZPiq1e2EA8MBWaA9L8BKvbeAIj+HIjW
GUi10/NRsoMIlIdwNAb104Mh6rmDKAajUkkAP7/qkxg5/b14dwc7BIAI4kOpAjLZ
T+Q9UAcC7Pfdl+ead3FiI9rb/j7ZFStm3rsU8+ia0fbgYW5PkHNaqbEDtnOVt3W/
2zKYirpJCazWBifzhM+KZFEhNvkgyXvvrRafTAfupcyO715iWk/MyL/PNNKXeznE
GW1K3cOSNro9+p//sjzihdh8nxEpdd13NTpKolznMQeP63neZS94giO4/ZqbgaR5
yvHhMG/+WMJJHEOHTH/td+tOWAchjaTGZT+ckGq1owHo6HrXL5dTayCH9MRhfEjC
XQ88l44h/JydhfxJAUAie2Kaht61WunA7lO0fYwDioiwpD87UFhANdMuS8QaAqYJ
lUMUul1O0SwmKEIPFhgXkD8dinkSk6T9MTY9xKMI88te/+QdLJg=
=V7z2
-----END PGP SIGNATURE-----
