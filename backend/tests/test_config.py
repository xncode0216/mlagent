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


def test_auth_defaults_to_explicit_development_mode():
    settings = Settings()

    assert settings.auth_mode == "development"
    assert settings.dev_user_id == "dev-user"


def test_jwt_secret_is_masked_in_settings_representation():
    raw_secret = "a-secret-that-must-not-appear-in-logs"
    settings = Settings(auth_jwt_secret=raw_secret)

    assert raw_secret not in repr(settings)
