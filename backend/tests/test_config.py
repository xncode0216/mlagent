from app.core.config import Settings


def test_cors_origins_default_includes_vite_dev_ports():
    settings = Settings()
    assert "http://127.0.0.1:5173" in settings.cors_origins
    assert "http://127.0.0.1:5174" in settings.cors_origins


def test_cors_origins_accepts_comma_separated_string():
    settings = Settings(cors_origins="http://a.test, http://b.test ,http://c.test")
    assert settings.cors_origins == ["http://a.test", "http://b.test", "http://c.test"]


def test_cors_origins_accepts_explicit_list():
    settings = Settings(cors_origins=["http://only.test"])
    assert settings.cors_origins == ["http://only.test"]
