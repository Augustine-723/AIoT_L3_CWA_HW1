"""
test_weather_api.py - Test suite for Vercel Serverless Weather API & Data Schema
Tests sample station schema, fallback mechanisms, wind vectors, and query parsing.
"""

import sys
import unittest

# Ensure UTF-8 console output on Windows
if sys.platform.startswith("win"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

from api.weather import get_sample_stations, COUNTY_COORDINATES


class TestWeatherAPI(unittest.TestCase):
    def test_sample_stations_structure(self):
        """Test that offline sample stations contain all required fields for Map-First UI"""
        stations = get_sample_stations()
        self.assertIsInstance(stations, list)
        self.assertGreaterEqual(len(stations), 5, "Sample stations should have at least 5 records")

        required_keys = {
            "id", "name", "county", "town", "lat", "lon",
            "temp", "cur_temp", "min_temp", "max_temp",
            "wx", "rain", "humidity", "pressure",
            "wind_speed", "wind_dir", "time"
        }

        for st in stations:
            for key in required_keys:
                self.assertIn(key, st, f"Station missing required key: {key}")

            # Lat & Lon validation
            self.assertGreater(st["lat"], 20.0, "Latitude should be in Taiwan range")
            self.assertLess(st["lat"], 27.0, "Latitude should be in Taiwan range")
            self.assertGreater(st["lon"], 118.0, "Longitude should be in Taiwan range")
            self.assertLess(st["lon"], 123.0, "Longitude should be in Taiwan range")

            # Numeric validations
            self.assertIsInstance(st["temp"], (int, float))
            self.assertGreaterEqual(st["temp"], -10.0)
            self.assertLessEqual(st["temp"], 50.0)

            # Wind speed & wind dir
            if st["wind_speed"] is not None:
                self.assertGreaterEqual(st["wind_speed"], 0.0)
            if st["wind_dir"] is not None:
                self.assertGreaterEqual(st["wind_dir"], 0.0)
                self.assertLessEqual(st["wind_dir"], 360.0)

    def test_county_coordinates(self):
        """Test that all 22 Taiwanese administrative divisions have fallback coordinates"""
        self.assertEqual(len(COUNTY_COORDINATES), 22, "Should have 22 administrative divisions")
        for county, coords in COUNTY_COORDINATES.items():
            self.assertEqual(len(coords), 2)
            lat, lon = coords
            self.assertTrue(21.0 <= lat <= 27.0, f"Latitude out of bounds for {county}: {lat}")
            self.assertTrue(118.0 <= lon <= 122.5, f"Longitude out of bounds for {county}: {lon}")


if __name__ == "__main__":
    unittest.main()
