-- contoh yg 2 level
SELECT  
l1.id as region1Id, 
l2.id as region2Id, 
null as region3Id, 
null as region4Id, 
null as region5Id, 
null as region6Id 
FROM level_2_ngibar l2 
LEFT JOIN level_1_ngibar l1 ON LEFT(l2.fullCode, 2) = l1.fullCode
order by region1Id,region2Id,region3Id,region4Id,region5Id,region6Id LIMIT 999999999