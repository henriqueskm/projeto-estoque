-- Generated from data/negocios-k-master-data.json.
-- Source SHA-256: 11F24F1F056BE1C8571C34E53BEA248663FB87BF6E874FDC5828DEB6DF41B669

do $$
declare
  v_master_data constant jsonb := $master_data${"servos":[{"code":"1","description":"SERVO MBF-015","model":"MBF-015","item_type":"SERVO","is_active":true},{"code":"1INV","description":"SERVO MBF-015 Invertido 028","model":"MBF-015 Invertido 028","item_type":"SERVO","is_active":true},{"code":"1DESL","description":"SERVO MBF-015 Deslocado","model":"MBF-015 Deslocado","item_type":"SERVO","is_active":true},{"code":"2","description":"SERVO MBF-025","model":"MBF-025","item_type":"SERVO","is_active":true},{"code":"2INV","description":"SERVO MBF-025 Invertido 015/VF","model":"MBF-025 Invertido 015/VF","item_type":"SERVO","is_active":true},{"code":"3","description":"SERVO CJ-015","model":"CJ-015","item_type":"SERVO","is_active":true},{"code":"4","description":"SERVO BR-015","model":"BR-015","item_type":"SERVO","is_active":true},{"code":"5","description":"SERVO MBF-040","model":"MBF-040","item_type":"SERVO","is_active":true},{"code":"5INV015","description":"SERVO MBF-040 Invertido 015/VF","model":"MBF-040 Invertido 015/VF","item_type":"SERVO","is_active":true},{"code":"5INV028","description":"SERVO MBF-040 Invertido 028","model":"MBF-040 Invertido 028","item_type":"SERVO","is_active":true},{"code":"6","description":"SERVO VF-040","model":"VF-040","item_type":"SERVO","is_active":true},{"code":"7","description":"SERVO BR-040","model":"BR-040","item_type":"SERVO","is_active":true},{"code":"7INV015","description":"SERVO BR-040 Invertido 015/VF","model":"BR-040 Invertido 015/VF","item_type":"SERVO","is_active":true},{"code":"7INV028","description":"SERVO BR-040 Invertido 028","model":"BR-040 Invertido 028","item_type":"SERVO","is_active":true},{"code":"9","description":"SERVO MBF-032","model":"MBF-032","item_type":"SERVO","is_active":true},{"code":"9INV","description":"SERVO MBF-032 Invertido 028","model":"MBF-032 Invertido 028","item_type":"SERVO","is_active":true},{"code":"10","description":"SERVO MC-040","model":"MC-040","item_type":"SERVO","is_active":true},{"code":"10RB","description":"SERVO MC-040 Rebaixado","model":"MC-040 Rebaixado","item_type":"SERVO","is_active":true},{"code":"11","description":"SERVO AL-10","model":"AL-10","item_type":"SERVO","is_active":true},{"code":"11INV","description":"SERVO AL-10 Invertido 028","model":"AL-10 Invertido 028","item_type":"SERVO","is_active":true},{"code":"12","description":"SERVO SAF-040","model":"SAF-040","item_type":"SERVO","is_active":true}],"kits":[{"code":"KT-01","description":"Kit de instalação 1A","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-02","description":"Kit de instalação 1B / 1D","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-03","description":"Kit de instalação 3C","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-04","description":"Kit de instalação 1C","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-05","description":"Kit de instalação 2F","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-06","description":"Kit de instalação 1E","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-07","description":"Kit de instalação 1F","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-08","description":"Kit de instalação 4E","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-09","description":"Kit de instalação 4B","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-10","description":"Kit de instalação 4C","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-11","description":"Kit de instalação 4F","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-11E","description":"Kit de instalação 11E","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-12","description":"Kit de instalação 7AC","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-12A","description":"Kit de instalação 12A","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-14","description":"Kit de instalação 3A","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-15","description":"Kit de instalação 3B","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-16","description":"Kit de instalação 7AD","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-17","description":"Kit de instalação 6G","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-18","description":"Kit de instalação 2A","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-19","description":"Kit de instalação 2B","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-20","description":"Kit de instalação 5J","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-21","description":"Kit de instalação 2C","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-22","description":"Kit de instalação 2E","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-23","description":"Kit de instalação 11A","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-24","description":"Kit de instalação 5B","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-25","description":"Kit de instalação 5C","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-26","description":"Kit de instalação 6H","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-27","description":"Kit de instalação 5E","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-28","description":"Kit de instalação 6J","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-29","description":"Kit de instalação 1H","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-30","description":"Kit de instalação 5D","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-31","description":"Kit de instalação 9A / 9D","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-32","description":"Kit de instalação 5L","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-35","description":"Kit de instalação 7E","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-36","description":"Kit de instalação 7Q","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-37","description":"Kit de instalação 7F","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-39","description":"Kit de instalação 7H","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-44","description":"Kit de instalação 7D","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-45","description":"Kit de instalação 6E / 6F","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-47","description":"Kit de instalação 5W","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-48","description":"Kit de instalação 10A / 10C","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-49","description":"Kit de instalação 10E","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-50","description":"Kit de instalação 6C / 6I","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-51","description":"Kit de instalação 6A","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-52","description":"Kit de instalação 6B","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-53","description":"Kit de instalação 2D / 5M","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-56","description":"Kit de instalação 7R","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-57","description":"Kit de instalação 5H","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-58","description":"Kit de instalação 6L","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-59","description":"Kit de instalação 5Z","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-5I","description":"Kit de instalação 5I","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-63","description":"Kit de instalação 6O","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-64","description":"Kit de instalação 6R","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-66","description":"Kit de instalação 7P","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-67","description":"Kit de instalação 5G","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-68","description":"Kit de instalação 7Y","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-69","description":"Kit de instalação 9B","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-70","description":"Kit de instalação 5F","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-71","description":"Kit de instalação 6P","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-72","description":"Kit de instalação 7X","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-73","description":"Kit de instalação 7Z","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-74","description":"Kit de instalação 9C","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-75","description":"Kit de instalação 10B","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-76","description":"Kit de instalação 10D","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-79","description":"Kit de instalação 7N","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-83","description":"Kit de instalação 7A","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-84","description":"Kit de instalação 5P","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-85","description":"Kit de instalação 11C","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-86","description":"Kit de instalação 11D","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-88","description":"Kit de instalação 5X","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-90","description":"Kit de instalação 7AB","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-91","description":"Kit de instalação 2H","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-92","description":"Kit de instalação 11B","item_type":"INSTALLATION_KIT","is_active":true},{"code":"KT-94","description":"Kit de instalação 7AF","item_type":"INSTALLATION_KIT","is_active":true}],"physical_configurations":[{"servo_code":"1","kit_code":"KT-01","display_description":"SERVO MBF-015 + KT-01","is_active":true},{"servo_code":"1","kit_code":"KT-02","display_description":"SERVO MBF-015 + KT-02","is_active":true},{"servo_code":"1","kit_code":"KT-04","display_description":"SERVO MBF-015 + KT-04","is_active":true},{"servo_code":"1","kit_code":"KT-06","display_description":"SERVO MBF-015 + KT-06","is_active":true},{"servo_code":"1INV","kit_code":"KT-07","display_description":"SERVO MBF-015 Invertido 028 + KT-07","is_active":true},{"servo_code":"1DESL","kit_code":"KT-29","display_description":"SERVO MBF-015 Deslocado + KT-29","is_active":true},{"servo_code":"2","kit_code":"KT-18","display_description":"SERVO MBF-025 + KT-18","is_active":true},{"servo_code":"2","kit_code":"KT-19","display_description":"SERVO MBF-025 + KT-19","is_active":true},{"servo_code":"2","kit_code":"KT-21","display_description":"SERVO MBF-025 + KT-21","is_active":true},{"servo_code":"2","kit_code":"KT-53","display_description":"SERVO MBF-025 + KT-53","is_active":true},{"servo_code":"2","kit_code":"KT-22","display_description":"SERVO MBF-025 + KT-22","is_active":true},{"servo_code":"2INV","kit_code":"KT-05","display_description":"SERVO MBF-025 Invertido 015/VF + KT-05","is_active":true},{"servo_code":"2INV","kit_code":"KT-91","display_description":"SERVO MBF-025 Invertido 015/VF + KT-91","is_active":true},{"servo_code":"3","kit_code":"KT-14","display_description":"SERVO CJ-015 + KT-14","is_active":true},{"servo_code":"3","kit_code":"KT-15","display_description":"SERVO CJ-015 + KT-15","is_active":true},{"servo_code":"3","kit_code":"KT-03","display_description":"SERVO CJ-015 + KT-03","is_active":true},{"servo_code":"4","kit_code":"KT-09","display_description":"SERVO BR-015 + KT-09","is_active":true},{"servo_code":"4","kit_code":"KT-10","display_description":"SERVO BR-015 + KT-10","is_active":true},{"servo_code":"4","kit_code":"KT-08","display_description":"SERVO BR-015 + KT-08","is_active":true},{"servo_code":"4","kit_code":"KT-11","display_description":"SERVO BR-015 + KT-11","is_active":true},{"servo_code":"5","kit_code":"KT-24","display_description":"SERVO MBF-040 + KT-24","is_active":true},{"servo_code":"5INV028","kit_code":"KT-25","display_description":"SERVO MBF-040 Invertido 028 + KT-25","is_active":true},{"servo_code":"5INV015","kit_code":"KT-30","display_description":"SERVO MBF-040 Invertido 015/VF + KT-30","is_active":true},{"servo_code":"5","kit_code":"KT-27","display_description":"SERVO MBF-040 + KT-27","is_active":true},{"servo_code":"5","kit_code":"KT-70","display_description":"SERVO MBF-040 + KT-70","is_active":true},{"servo_code":"5","kit_code":"KT-67","display_description":"SERVO MBF-040 + KT-67","is_active":true},{"servo_code":"6","kit_code":"KT-57","display_description":"SERVO VF-040 + KT-57","is_active":true},{"servo_code":"5","kit_code":"KT-5I","display_description":"SERVO MBF-040 + KT-5I","is_active":true},{"servo_code":"5","kit_code":"KT-20","display_description":"SERVO MBF-040 + KT-20","is_active":true},{"servo_code":"5","kit_code":"KT-32","display_description":"SERVO MBF-040 + KT-32","is_active":true},{"servo_code":"5","kit_code":"KT-53","display_description":"SERVO MBF-040 + KT-53","is_active":true},{"servo_code":"5","kit_code":"KT-84","display_description":"SERVO MBF-040 + KT-84","is_active":true},{"servo_code":"5INV028","kit_code":"KT-47","display_description":"SERVO MBF-040 Invertido 028 + KT-47","is_active":true},{"servo_code":"5","kit_code":"KT-88","display_description":"SERVO MBF-040 + KT-88","is_active":true},{"servo_code":"5","kit_code":"KT-59","display_description":"SERVO MBF-040 + KT-59","is_active":true},{"servo_code":"6","kit_code":"KT-51","display_description":"SERVO VF-040 + KT-51","is_active":true},{"servo_code":"6","kit_code":"KT-52","display_description":"SERVO VF-040 + KT-52","is_active":true},{"servo_code":"6","kit_code":"KT-50","display_description":"SERVO VF-040 + KT-50","is_active":true},{"servo_code":"6","kit_code":"KT-45","display_description":"SERVO VF-040 + KT-45","is_active":true},{"servo_code":"6","kit_code":"KT-17","display_description":"SERVO VF-040 + KT-17","is_active":true},{"servo_code":"6","kit_code":"KT-26","display_description":"SERVO VF-040 + KT-26","is_active":true},{"servo_code":"6","kit_code":"KT-28","display_description":"SERVO VF-040 + KT-28","is_active":true},{"servo_code":"6","kit_code":"KT-58","display_description":"SERVO VF-040 + KT-58","is_active":true},{"servo_code":"6","kit_code":"KT-63","display_description":"SERVO VF-040 + KT-63","is_active":true},{"servo_code":"6","kit_code":"KT-71","display_description":"SERVO VF-040 + KT-71","is_active":true},{"servo_code":"6","kit_code":"KT-64","display_description":"SERVO VF-040 + KT-64","is_active":true},{"servo_code":"7INV015","kit_code":"KT-83","display_description":"SERVO BR-040 Invertido 015/VF + KT-83","is_active":true},{"servo_code":"7","kit_code":"KT-90","display_description":"SERVO BR-040 + KT-90","is_active":true},{"servo_code":"7INV028","kit_code":"KT-12","display_description":"SERVO BR-040 Invertido 028 + KT-12","is_active":true},{"servo_code":"7INV028","kit_code":"KT-16","display_description":"SERVO BR-040 Invertido 028 + KT-16","is_active":true},{"servo_code":"7INV028","kit_code":"KT-94","display_description":"SERVO BR-040 Invertido 028 + KT-94","is_active":true},{"servo_code":"7INV028","kit_code":"KT-44","display_description":"SERVO BR-040 Invertido 028 + KT-44","is_active":true},{"servo_code":"7","kit_code":"KT-35","display_description":"SERVO BR-040 + KT-35","is_active":true},{"servo_code":"7","kit_code":"KT-37","display_description":"SERVO BR-040 + KT-37","is_active":true},{"servo_code":"7","kit_code":"KT-39","display_description":"SERVO BR-040 + KT-39","is_active":true},{"servo_code":"7INV015","kit_code":"KT-79","display_description":"SERVO BR-040 Invertido 015/VF + KT-79","is_active":true},{"servo_code":"7INV015","kit_code":"KT-66","display_description":"SERVO BR-040 Invertido 015/VF + KT-66","is_active":true},{"servo_code":"7INV015","kit_code":"KT-36","display_description":"SERVO BR-040 Invertido 015/VF + KT-36","is_active":true},{"servo_code":"7","kit_code":"KT-56","display_description":"SERVO BR-040 + KT-56","is_active":true},{"servo_code":"7","kit_code":"KT-72","display_description":"SERVO BR-040 + KT-72","is_active":true},{"servo_code":"7INV015","kit_code":"KT-68","display_description":"SERVO BR-040 Invertido 015/VF + KT-68","is_active":true},{"servo_code":"7","kit_code":"KT-73","display_description":"SERVO BR-040 + KT-73","is_active":true},{"servo_code":"9","kit_code":"KT-31","display_description":"SERVO MBF-032 + KT-31","is_active":true},{"servo_code":"9","kit_code":"KT-69","display_description":"SERVO MBF-032 + KT-69","is_active":true},{"servo_code":"9INV","kit_code":"KT-74","display_description":"SERVO MBF-032 Invertido 028 + KT-74","is_active":true},{"servo_code":"10","kit_code":"KT-48","display_description":"SERVO MC-040 + KT-48","is_active":true},{"servo_code":"10","kit_code":"KT-75","display_description":"SERVO MC-040 + KT-75","is_active":true},{"servo_code":"10RB","kit_code":"KT-48","display_description":"SERVO MC-040 Rebaixado + KT-48","is_active":true},{"servo_code":"10","kit_code":"KT-76","display_description":"SERVO MC-040 + KT-76","is_active":true},{"servo_code":"10","kit_code":"KT-49","display_description":"SERVO MC-040 + KT-49","is_active":true},{"servo_code":"11INV","kit_code":"KT-23","display_description":"SERVO AL-10 Invertido 028 + KT-23","is_active":true},{"servo_code":"11","kit_code":"KT-92","display_description":"SERVO AL-10 + KT-92","is_active":true},{"servo_code":"11","kit_code":"KT-85","display_description":"SERVO AL-10 + KT-85","is_active":true},{"servo_code":"11","kit_code":"KT-86","display_description":"SERVO AL-10 + KT-86","is_active":true},{"servo_code":"11","kit_code":"KT-11E","display_description":"SERVO AL-10 + KT-11E","is_active":true},{"servo_code":"12","kit_code":"KT-12A","display_description":"SERVO SAF-040 + KT-12A","is_active":true}],"commercial_codes":[{"code":"1A","servo_code":"1","kit_code":"KT-01","is_active":true},{"code":"1B","servo_code":"1","kit_code":"KT-02","is_active":true},{"code":"1C","servo_code":"1","kit_code":"KT-04","is_active":true},{"code":"1D","servo_code":"1","kit_code":"KT-02","is_active":true},{"code":"1E","servo_code":"1","kit_code":"KT-06","is_active":true},{"code":"1F","servo_code":"1INV","kit_code":"KT-07","is_active":true},{"code":"1H","servo_code":"1DESL","kit_code":"KT-29","is_active":true},{"code":"2A","servo_code":"2","kit_code":"KT-18","is_active":true},{"code":"2B","servo_code":"2","kit_code":"KT-19","is_active":true},{"code":"2C","servo_code":"2","kit_code":"KT-21","is_active":true},{"code":"2D","servo_code":"2","kit_code":"KT-53","is_active":true},{"code":"2E","servo_code":"2","kit_code":"KT-22","is_active":true},{"code":"2F","servo_code":"2INV","kit_code":"KT-05","is_active":true},{"code":"2H","servo_code":"2INV","kit_code":"KT-91","is_active":true},{"code":"3A","servo_code":"3","kit_code":"KT-14","is_active":true},{"code":"3B","servo_code":"3","kit_code":"KT-15","is_active":true},{"code":"3C","servo_code":"3","kit_code":"KT-03","is_active":true},{"code":"4B","servo_code":"4","kit_code":"KT-09","is_active":true},{"code":"4C","servo_code":"4","kit_code":"KT-10","is_active":true},{"code":"4E","servo_code":"4","kit_code":"KT-08","is_active":true},{"code":"4F","servo_code":"4","kit_code":"KT-11","is_active":true},{"code":"5B","servo_code":"5","kit_code":"KT-24","is_active":true},{"code":"5C","servo_code":"5INV028","kit_code":"KT-25","is_active":true},{"code":"5D","servo_code":"5INV015","kit_code":"KT-30","is_active":true},{"code":"5E","servo_code":"5","kit_code":"KT-27","is_active":true},{"code":"5F","servo_code":"5","kit_code":"KT-70","is_active":true},{"code":"5G","servo_code":"5","kit_code":"KT-67","is_active":true},{"code":"5H","servo_code":"6","kit_code":"KT-57","is_active":true},{"code":"5I","servo_code":"5","kit_code":"KT-5I","is_active":true},{"code":"5J","servo_code":"5","kit_code":"KT-20","is_active":true},{"code":"5L","servo_code":"5","kit_code":"KT-32","is_active":true},{"code":"5M","servo_code":"5","kit_code":"KT-53","is_active":true},{"code":"5P","servo_code":"5","kit_code":"KT-84","is_active":true},{"code":"5W","servo_code":"5INV028","kit_code":"KT-47","is_active":true},{"code":"5X","servo_code":"5","kit_code":"KT-88","is_active":true},{"code":"5Z","servo_code":"5","kit_code":"KT-59","is_active":true},{"code":"6A","servo_code":"6","kit_code":"KT-51","is_active":true},{"code":"6B","servo_code":"6","kit_code":"KT-52","is_active":true},{"code":"6C","servo_code":"6","kit_code":"KT-50","is_active":true},{"code":"6E","servo_code":"6","kit_code":"KT-45","is_active":true},{"code":"6F","servo_code":"6","kit_code":"KT-45","is_active":true},{"code":"6G","servo_code":"6","kit_code":"KT-17","is_active":true},{"code":"6H","servo_code":"6","kit_code":"KT-26","is_active":true},{"code":"6I","servo_code":"6","kit_code":"KT-50","is_active":true},{"code":"6J","servo_code":"6","kit_code":"KT-28","is_active":true},{"code":"6L","servo_code":"6","kit_code":"KT-58","is_active":true},{"code":"6O","servo_code":"6","kit_code":"KT-63","is_active":true},{"code":"6P","servo_code":"6","kit_code":"KT-71","is_active":true},{"code":"6R","servo_code":"6","kit_code":"KT-64","is_active":true},{"code":"7A","servo_code":"7INV015","kit_code":"KT-83","is_active":true},{"code":"7AB","servo_code":"7","kit_code":"KT-90","is_active":true},{"code":"7AC","servo_code":"7INV028","kit_code":"KT-12","is_active":true},{"code":"7AD","servo_code":"7INV028","kit_code":"KT-16","is_active":true},{"code":"7AF","servo_code":"7INV028","kit_code":"KT-94","is_active":true},{"code":"7D","servo_code":"7INV028","kit_code":"KT-44","is_active":true},{"code":"7E","servo_code":"7","kit_code":"KT-35","is_active":true},{"code":"7F","servo_code":"7","kit_code":"KT-37","is_active":true},{"code":"7H","servo_code":"7","kit_code":"KT-39","is_active":true},{"code":"7N","servo_code":"7INV015","kit_code":"KT-79","is_active":true},{"code":"7P","servo_code":"7INV015","kit_code":"KT-66","is_active":true},{"code":"7Q","servo_code":"7INV015","kit_code":"KT-36","is_active":true},{"code":"7R","servo_code":"7","kit_code":"KT-56","is_active":true},{"code":"7X","servo_code":"7","kit_code":"KT-72","is_active":true},{"code":"7Y","servo_code":"7INV015","kit_code":"KT-68","is_active":true},{"code":"7Z","servo_code":"7","kit_code":"KT-73","is_active":true},{"code":"9A","servo_code":"9","kit_code":"KT-31","is_active":true},{"code":"9B","servo_code":"9","kit_code":"KT-69","is_active":true},{"code":"9C","servo_code":"9INV","kit_code":"KT-74","is_active":true},{"code":"9D","servo_code":"9","kit_code":"KT-31","is_active":true},{"code":"10A","servo_code":"10","kit_code":"KT-48","is_active":true},{"code":"10B","servo_code":"10","kit_code":"KT-75","is_active":true},{"code":"10C","servo_code":"10RB","kit_code":"KT-48","is_active":true},{"code":"10D","servo_code":"10","kit_code":"KT-76","is_active":true},{"code":"10E","servo_code":"10","kit_code":"KT-49","is_active":true},{"code":"11A","servo_code":"11INV","kit_code":"KT-23","is_active":true},{"code":"11B","servo_code":"11","kit_code":"KT-92","is_active":true},{"code":"11C","servo_code":"11","kit_code":"KT-85","is_active":true},{"code":"11D","servo_code":"11","kit_code":"KT-86","is_active":true},{"code":"11E","servo_code":"11","kit_code":"KT-11E","is_active":true},{"code":"12A","servo_code":"12","kit_code":"KT-12A","is_active":true}],"repairs":[{"code":"R064","description":"JOGO DE REPARO 064","item_type":"REPAIR_KIT","is_active":true},{"code":"R065","description":"JOGO DE REPARO 065","item_type":"REPAIR_KIT","is_active":true},{"code":"R066","description":"JOGO DE REPARO 066","item_type":"REPAIR_KIT","is_active":true},{"code":"R067","description":"JOGO DE REPARO 067","item_type":"REPAIR_KIT","is_active":true},{"code":"R068","description":"JOGO DE REPARO 068","item_type":"REPAIR_KIT","is_active":true}],"repair_compatibility":[{"repair_code":"R064","servo_code":"1"},{"repair_code":"R064","servo_code":"1INV"},{"repair_code":"R064","servo_code":"1DESL"},{"repair_code":"R064","servo_code":"3"},{"repair_code":"R064","servo_code":"4"},{"repair_code":"R065","servo_code":"7"},{"repair_code":"R065","servo_code":"7INV015"},{"repair_code":"R065","servo_code":"7INV028"},{"repair_code":"R065","servo_code":"2"},{"repair_code":"R065","servo_code":"2INV"},{"repair_code":"R065","servo_code":"5"},{"repair_code":"R065","servo_code":"5INV015"},{"repair_code":"R065","servo_code":"5INV028"},{"repair_code":"R065","servo_code":"11"},{"repair_code":"R065","servo_code":"11INV"},{"repair_code":"R066","servo_code":"6"},{"repair_code":"R067","servo_code":"9"},{"repair_code":"R067","servo_code":"9INV"},{"repair_code":"R068","servo_code":"10"},{"repair_code":"R068","servo_code":"10RB"},{"repair_code":"R068","servo_code":"12"}]}$master_data$::jsonb;
  v_record record;
  v_item_id uuid;
  v_servo_id uuid;
  v_installation_kit_id uuid;
  v_repair_kit_id uuid;
  v_configuration_id uuid;
  v_existing_configuration_id uuid;
  v_existing_description text;
  v_existing_item_type text;
  v_existing_model text;
  v_existing_is_active boolean;
begin
  -- Normalize only the exact legacy description created by the initial test seed.
  update public.items
  set description = 'Kit de instalação 2A',
      updated_at = now()
  where code = 'KT-18'
    and item_type = 'INSTALLATION_KIT'
    and description = 'Kit de instalação KT-18';

  for v_record in
    select *
    from (
      select code, description, item_type, is_active
      from jsonb_to_recordset(v_master_data -> 'servos') as servo (
        code text,
        description text,
        item_type text,
        is_active boolean
      )
      union all
      select code, description, item_type, is_active
      from jsonb_to_recordset(v_master_data -> 'kits') as kit (
        code text,
        description text,
        item_type text,
        is_active boolean
      )
      union all
      select code, description, item_type, is_active
      from jsonb_to_recordset(v_master_data -> 'repairs') as repair (
        code text,
        description text,
        item_type text,
        is_active boolean
      )
    ) as master_item
  loop
    insert into public.items (
      code,
      description,
      item_type,
      is_active
    )
    values (
      v_record.code,
      v_record.description,
      v_record.item_type,
      v_record.is_active
    )
    on conflict (code) do nothing;

    select id, description, item_type, is_active
    into
      v_item_id,
      v_existing_description,
      v_existing_item_type,
      v_existing_is_active
    from public.items
    where code = v_record.code;

    if not found then
      raise exception using
        errcode = '23514',
        message = format('Could not resolve master item code %s.', v_record.code);
    end if;

    if v_existing_description is distinct from v_record.description
      or v_existing_item_type is distinct from v_record.item_type
      or v_existing_is_active is distinct from v_record.is_active then
      raise exception using
        errcode = '23514',
        message = format(
          'Item code %s conflicts with the master catalog data.',
          v_record.code
        );
    end if;
  end loop;

  for v_record in
    select code, model
    from jsonb_to_recordset(v_master_data -> 'servos') as servo (
      code text,
      model text
    )
  loop
    select id
    into v_item_id
    from public.items
    where code = v_record.code
      and item_type = 'SERVO';

    if not found then
      raise exception using
        errcode = '23514',
        message = format('Could not resolve servo item code %s.', v_record.code);
    end if;

    insert into public.servo_models (item_id, model)
    values (v_item_id, v_record.model)
    on conflict (item_id) do nothing;

    select model
    into v_existing_model
    from public.servo_models
    where item_id = v_item_id;

    if not found or v_existing_model is distinct from v_record.model then
      raise exception using
        errcode = '23514',
        message = format(
          'Servo item code %s conflicts with master model %s.',
          v_record.code,
          v_record.model
        );
    end if;
  end loop;

  for v_record in
    select code
    from jsonb_to_recordset(v_master_data -> 'kits') as kit (code text)
  loop
    select id
    into v_item_id
    from public.items
    where code = v_record.code
      and item_type = 'INSTALLATION_KIT';

    if not found then
      raise exception using
        errcode = '23514',
        message = format(
          'Could not resolve installation kit item code %s.',
          v_record.code
        );
    end if;

    insert into public.installation_kits (item_id)
    values (v_item_id)
    on conflict (item_id) do nothing;
  end loop;

  for v_record in
    select code
    from jsonb_to_recordset(v_master_data -> 'repairs') as repair (code text)
  loop
    select id
    into v_item_id
    from public.items
    where code = v_record.code
      and item_type = 'REPAIR_KIT';

    if not found then
      raise exception using
        errcode = '23514',
        message = format(
          'Could not resolve repair kit item code %s.',
          v_record.code
        );
    end if;

    insert into public.repair_kits (item_id)
    values (v_item_id)
    on conflict (item_id) do nothing;
  end loop;

  -- Normalize only the exact physical description created by the test seed.
  update public.commercial_configurations as configuration
  set description = 'SERVO MBF-025 + KT-18',
      updated_at = now()
  from public.items as servo, public.items as installation_kit
  where configuration.servo_id = servo.id
    and configuration.installation_kit_id = installation_kit.id
    and servo.code = '2'
    and installation_kit.code = 'KT-18'
    and configuration.description = 'SERVO MBF-025 + KIT KT-18';

  for v_record in
    select servo_code, kit_code, display_description, is_active
    from jsonb_to_recordset(
      v_master_data -> 'physical_configurations'
    ) as physical_configuration (
      servo_code text,
      kit_code text,
      display_description text,
      is_active boolean
    )
  loop
    select id
    into v_servo_id
    from public.items
    where code = v_record.servo_code
      and item_type = 'SERVO';

    if not found then
      raise exception using
        errcode = '23503',
        message = format(
          'Physical configuration references missing servo code %s.',
          v_record.servo_code
        );
    end if;

    select id
    into v_installation_kit_id
    from public.items
    where code = v_record.kit_code
      and item_type = 'INSTALLATION_KIT';

    if not found then
      raise exception using
        errcode = '23503',
        message = format(
          'Physical configuration references missing installation kit code %s.',
          v_record.kit_code
        );
    end if;

    insert into public.commercial_configurations (
      description,
      servo_id,
      installation_kit_id,
      is_active
    )
    values (
      v_record.display_description,
      v_servo_id,
      v_installation_kit_id,
      v_record.is_active
    )
    on conflict (servo_id, installation_kit_id) do nothing;

    select id, description, is_active
    into
      v_configuration_id,
      v_existing_description,
      v_existing_is_active
    from public.commercial_configurations
    where servo_id = v_servo_id
      and installation_kit_id = v_installation_kit_id;

    if not found then
      raise exception using
        errcode = '23514',
        message = format(
          'Could not resolve physical configuration %s + %s.',
          v_record.servo_code,
          v_record.kit_code
        );
    end if;

    if v_existing_description is distinct from v_record.display_description
      or v_existing_is_active is distinct from v_record.is_active then
      raise exception using
        errcode = '23514',
        message = format(
          'Physical configuration %s + %s conflicts with the master catalog data.',
          v_record.servo_code,
          v_record.kit_code
        );
    end if;
  end loop;

  for v_record in
    select code, servo_code, kit_code, is_active
    from jsonb_to_recordset(
      v_master_data -> 'commercial_codes'
    ) as commercial_code (
      code text,
      servo_code text,
      kit_code text,
      is_active boolean
    )
  loop
    select configuration.id
    into v_configuration_id
    from public.commercial_configurations as configuration
    join public.items as servo
      on servo.id = configuration.servo_id
    join public.items as installation_kit
      on installation_kit.id = configuration.installation_kit_id
    where servo.code = v_record.servo_code
      and installation_kit.code = v_record.kit_code;

    if not found then
      raise exception using
        errcode = '23503',
        message = format(
          'Commercial code %s references a missing physical configuration.',
          v_record.code
        );
    end if;

    insert into public.commercial_configuration_codes (
      configuration_id,
      code,
      is_active
    )
    values (
      v_configuration_id,
      v_record.code,
      v_record.is_active
    )
    on conflict (code) do nothing;

    select configuration_id, is_active
    into v_existing_configuration_id, v_existing_is_active
    from public.commercial_configuration_codes
    where code = v_record.code;

    if not found then
      raise exception using
        errcode = '23514',
        message = format(
          'Could not resolve commercial code %s.',
          v_record.code
        );
    end if;

    if v_existing_configuration_id is distinct from v_configuration_id
      or v_existing_is_active is distinct from v_record.is_active then
      raise exception using
        errcode = '23514',
        message = format(
          'Commercial code %s conflicts with the master catalog data.',
          v_record.code
        );
    end if;
  end loop;

  for v_record in
    select repair_code, servo_code
    from jsonb_to_recordset(
      v_master_data -> 'repair_compatibility'
    ) as repair_compatibility (
      repair_code text,
      servo_code text
    )
  loop
    select id
    into v_servo_id
    from public.items
    where code = v_record.servo_code
      and item_type = 'SERVO';

    if not found then
      raise exception using
        errcode = '23503',
        message = format(
          'Repair compatibility references missing servo code %s.',
          v_record.servo_code
        );
    end if;

    select id
    into v_repair_kit_id
    from public.items
    where code = v_record.repair_code
      and item_type = 'REPAIR_KIT';

    if not found then
      raise exception using
        errcode = '23503',
        message = format(
          'Repair compatibility references missing repair code %s.',
          v_record.repair_code
        );
    end if;

    insert into public.servo_repair_compatibility (
      servo_id,
      repair_kit_id
    )
    values (
      v_servo_id,
      v_repair_kit_id
    )
    on conflict (servo_id, repair_kit_id) do nothing;
  end loop;
end;
$$;
