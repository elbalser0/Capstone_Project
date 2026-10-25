-- show the tables names 
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- shows the table name with its columns, data_type, is_nullable, and columndefaults
SELECT
    table_name,
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;

WITH table_columns AS (
    SELECT
        table_name,
        array_agg(column_name::text ORDER BY ordinal_position) AS cols
    FROM information_schema.columns
    WHERE table_schema = 'public'
    GROUP BY table_name
)
SELECT
    table_name,
    cols[1]  AS column_1,
    cols[2]  AS column_2,
    cols[3]  AS column_3,
    cols[4]  AS column_4,
    cols[5]  AS column_5,
    cols[6]  AS column_6,
    cols[7]  AS column_7,
    cols[8]  AS column_8,
    cols[9]  AS column_9,
    cols[10] AS column_10,
    cols[11] AS column_11,
    cols[12] AS column_12,
    cols[13] AS column_13,
    cols[14] AS column_14
FROM table_columns
ORDER BY table_name;
