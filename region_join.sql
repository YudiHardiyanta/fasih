-- contoh yg 2 level
SELECT  
l1.id as region1Id, 
l2.id as region2Id, 
null as region3Id, 
null as region4Id, 
null as region5Id, 
null as region6Id 
FROM level_2 l2 
LEFT JOIN level_1 l1 ON LEFT(l2.fullCode, 2) = l1.fullCode;