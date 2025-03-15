include(GNUInstallDirs)
include(CMakePackageConfigHelpers)

set(CMAKE_INSTALL_CMAKEDIR "${CMAKE_INSTALL_DATADIR}/cmake/instrmt" CACHE PATH "Install location for cmake related files")
mark_as_advanced(CMAKE_INSTALL_CMAKEDIR)

install(
  TARGETS
  instrmt instrmt-noop
  EXPORT InstrmtTargets
)

install(
  TARGETS
  instrmt-tty
  instrmt-tty-wrapper
  EXPORT InstrmtTargets
  LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR}
)

install(FILES
  instrmt/tty/tty-utils.h
  instrmt/tty/tty-wrapper.hxx
  DESTINATION ${CMAKE_INSTALL_INCLUDEDIR}/instrmt/tty)

if (INSTRMT_BUILD_ITT_ENGINE)
  install(
    TARGETS
    instrmt-itt
    instrmt-itt-wrapper
    EXPORT InstrmtTargets
    LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR}
  )

  install(
    FILES instrmt/itt/itt-wrapper.hxx
    DESTINATION ${CMAKE_INSTALL_INCLUDEDIR}/instrmt/itt
  )
endif()

if (INSTRMT_BUILD_TRACY_ENGINE)
  install(
    TARGETS
    instrmt-tracy
    instrmt-tracy-wrapper
    EXPORT InstrmtTargets
    LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR}
  )

  install(
    FILES instrmt/tracy/tracy-wrapper.hxx
    DESTINATION ${CMAKE_INSTALL_INCLUDEDIR}/instrmt/tracy
  )
endif()

install(
  FILES instrmt/instrmt.hxx
  DESTINATION ${CMAKE_INSTALL_INCLUDEDIR}/instrmt
)

install(
  FILES
  instrmt/details/utils.h
  instrmt/details/utils.hxx
  instrmt/details/base.hxx
  instrmt/details/engine.hxx
  DESTINATION ${CMAKE_INSTALL_INCLUDEDIR}/instrmt/details
)

# Create the export file for the build tree.
export(TARGETS instrmt instrmt-noop instrmt-tty-wrapper FILE "${CMAKE_CURRENT_BINARY_DIR}/InstrmtTargets.cmake")

if (INSTRMT_BUILD_ITT_ENGINE)
  export(TARGETS instrmt-itt-wrapper APPEND FILE "${CMAKE_CURRENT_BINARY_DIR}/InstrmtTargets.cmake")
endif()

if (INSTRMT_BUILD_TRACY_ENGINE)
  export(TARGETS instrmt-tracy-wrapper APPEND FILE "${CMAKE_CURRENT_BINARY_DIR}/InstrmtTargets.cmake")
endif()

# Create the export file for the install tree.
install(EXPORT InstrmtTargets DESTINATION "${CMAKE_INSTALL_CMAKEDIR}")

# Create the config file for the build tree.
configure_package_config_file(
  "${CMAKE_CURRENT_SOURCE_DIR}/InstrmtConfig.in.cmake"
  "${CMAKE_CURRENT_BINARY_DIR}/InstrmtConfig.cmake"
  INSTALL_DESTINATION ${CMAKE_CURRENT_BINARY_DIR}
  INSTALL_PREFIX ${CMAKE_CURRENT_BINARY_DIR}
)

# Create the config file for the install tree.
configure_package_config_file(
  "${CMAKE_CURRENT_SOURCE_DIR}/InstrmtConfig.in.cmake"
  "${CMAKE_CURRENT_BINARY_DIR}/InstrmtConfig.install.cmake"
  INSTALL_DESTINATION ${CMAKE_INSTALL_CMAKEDIR}
)

# Create the package version file.
write_basic_package_version_file(
  "${CMAKE_CURRENT_BINARY_DIR}/InstrmtConfigVersion.cmake"
  COMPATIBILITY SameMajorVersion
)

install(
  FILES "${CMAKE_CURRENT_BINARY_DIR}/InstrmtConfigVersion.cmake"
  DESTINATION ${CMAKE_INSTALL_CMAKEDIR}
)

install(
  FILES "${CMAKE_CURRENT_BINARY_DIR}/InstrmtConfig.install.cmake"
  DESTINATION ${CMAKE_INSTALL_CMAKEDIR}
  RENAME InstrmtConfig.cmake
)
