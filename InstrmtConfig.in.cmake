get_filename_component(PACKAGE_CMAKE_DIR "${CMAKE_CURRENT_LIST_FILE}" PATH)
set(INSTRMT_INCLUDE_DIRS "@CONF_INCLUDE_DIRS@")

if(NOT TARGET instrmt)
  include("${PACKAGE_CMAKE_DIR}/@INSTRMT_EXPORT@.cmake")
endif()
