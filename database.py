"""
database.py - SQLite 資料庫模組
建立 data.db 與 TemperatureForecasts 資料表，並提供資料寫入與查詢方法
"""

import sqlite3
import os
import pandas as pd
from typing import List, Dict, Any, Optional

DEFAULT_DB_PATH = os.path.join(os.path.dirname(__file__), "data.db")


def get_connection(db_path: str = DEFAULT_DB_PATH) -> sqlite3.Connection:
    """取得 SQLite 資料庫連線"""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def init_db(db_path: str = DEFAULT_DB_PATH) -> None:
    """
    初始化資料庫，建立 TemperatureForecasts 資料表與索引
    """
    conn = get_connection(db_path)
    cursor = conn.cursor()

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS TemperatureForecasts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            location_name TEXT NOT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            min_temp REAL NOT NULL,
            max_temp REAL NOT NULL,
            weather_condition TEXT,
            rain_prob TEXT,
            comfort_index TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (location_name, start_time, end_time)
        )
    """)

    # 建立加速查詢的索引
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_location_time 
        ON TemperatureForecasts (location_name, start_time)
    """)

    conn.commit()
    conn.close()


def save_forecasts(forecasts: List[Dict[str, Any]], db_path: str = DEFAULT_DB_PATH) -> int:
    """
    將氣象資料寫入 TemperatureForecasts 資料表。
    若已存在相同 (location_name, start_time, end_time) 則執行更新 (INSERT OR REPLACE)。
    :return: 成功寫入或更新的筆數
    """
    if not forecasts:
        return 0

    init_db(db_path)
    conn = get_connection(db_path)
    cursor = conn.cursor()

    sql = """
        INSERT OR REPLACE INTO TemperatureForecasts (
            location_name,
            start_time,
            end_time,
            min_temp,
            max_temp,
            weather_condition,
            rain_prob,
            comfort_index
        ) VALUES (
            :location_name,
            :start_time,
            :end_time,
            :min_temp,
            :max_temp,
            :weather_condition,
            :rain_prob,
            :comfort_index
        )
    """

    cursor.executemany(sql, forecasts)
    row_count = cursor.rowcount
    conn.commit()
    conn.close()
    return row_count


def get_all_locations(db_path: str = DEFAULT_DB_PATH) -> List[str]:
    """取得資料庫中所有的縣市名稱"""
    init_db(db_path)
    conn = get_connection(db_path)
    cursor = conn.cursor()

    cursor.execute("""
        SELECT DISTINCT location_name 
        FROM TemperatureForecasts 
        ORDER BY location_name ASC
    """)
    rows = cursor.fetchall()
    conn.close()

    return [row["location_name"] for row in rows]


def get_all_forecasts(db_path: str = DEFAULT_DB_PATH) -> pd.DataFrame:
    """取得所有預報資料回傳為 pandas DataFrame"""
    init_db(db_path)
    conn = get_connection(db_path)
    df = pd.read_sql_query("""
        SELECT id, location_name, start_time, end_time, min_temp, max_temp, 
               weather_condition, rain_prob, comfort_index, created_at
        FROM TemperatureForecasts
        ORDER BY start_time ASC, location_name ASC
    """, conn)
    conn.close()
    return df


def get_forecasts_by_location(location_name: str, db_path: str = DEFAULT_DB_PATH) -> pd.DataFrame:
    """
    依據指定縣市名稱查詢預報資料
    """
    init_db(db_path)
    conn = get_connection(db_path)
    df = pd.read_sql_query("""
        SELECT id, location_name, start_time, end_time, min_temp, max_temp, 
               weather_condition, rain_prob, comfort_index, created_at
        FROM TemperatureForecasts
        WHERE location_name = ?
        ORDER BY start_time ASC
    """, conn, params=(location_name,))
    conn.close()
    return df


def get_latest_overview(db_path: str = DEFAULT_DB_PATH) -> pd.DataFrame:
    """
    取得各地區最新一個預報時段的摘要資料 (供首頁與地圖視覺化使用)
    """
    init_db(db_path)
    conn = get_connection(db_path)
    query = """
        SELECT t1.location_name, t1.start_time, t1.end_time, 
               t1.min_temp, t1.max_temp, t1.weather_condition, 
               t1.rain_prob, t1.comfort_index
        FROM TemperatureForecasts t1
        INNER JOIN (
            SELECT location_name, MIN(start_time) as min_start
            FROM TemperatureForecasts
            GROUP BY location_name
        ) t2 ON t1.location_name = t2.location_name AND t1.start_time = t2.min_start
        ORDER BY t1.location_name ASC
    """
    df = pd.read_sql_query(query, conn)
    conn.close()
    return df
