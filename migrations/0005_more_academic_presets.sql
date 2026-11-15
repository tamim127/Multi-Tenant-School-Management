-- Additional starting categories; each remains editable after application.
INSERT INTO academic_presets(key,version,institution_type,category,definition) VALUES
('nursery-school',1,'school','Nursery School','{"units":[{"code":"nursery","name":"Nursery","unitType":"nursery","programs":[{"code":"nursery","name":"Nursery","progressionModel":"class","levels":["Play","Nursery"]}]}]}'),
('junior-school',1,'school','Junior School','{"units":[{"code":"junior","name":"Junior","unitType":"junior","programs":[{"code":"junior","name":"Junior","progressionModel":"class","levels":["Class 6","Class 7","Class 8"]}]}]}'),
('high-school',1,'school','High School','{"units":[{"code":"high","name":"High School","unitType":"secondary","programs":[{"code":"high","name":"High School","progressionModel":"class","levels":["Class 9","Class 10"]}]}]}'),
('higher-secondary-school',1,'school','Higher Secondary School','{"units":[{"code":"higher-secondary","name":"Higher Secondary","unitType":"secondary","programs":[{"code":"hsc","name":"HSC","progressionModel":"year","levels":["Class 11","Class 12"]}]}]}'),
('postgraduate-college',1,'college','Postgraduate College','{"units":[{"code":"postgraduate","name":"Postgraduate","unitType":"postgraduate","programs":[{"code":"postgraduate","name":"Postgraduate","progressionModel":"credit","levels":["Masters","Research"]}]}]}'),
('nurani-madrasa',1,'madrasa','Nurani Madrasa','{"units":[{"code":"nurani","name":"Nurani","unitType":"nurani","programs":[{"code":"nurani","name":"Nurani","progressionModel":"competency","levels":["Nurani"]}]}]}'),
('combined-institution',1,'combined','Combined Educational Institution','{"units":[]}');
