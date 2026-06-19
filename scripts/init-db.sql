-- Initialize FlowLink database
CREATE DATABASE IF NOT EXISTS flowlink;
CREATE USER IF NOT EXISTS flowlink WITH PASSWORD 'flowlink';
GRANT ALL PRIVILEGES ON DATABASE flowlink TO flowlink;

