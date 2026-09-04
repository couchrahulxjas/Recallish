from pathlib import Path

from recallish.config import default_config_path, load_config


def test_relative_data_dir_resolves_against_config_folder(tmp_path: Path) -> None:
    config_file = tmp_path / "recallish.yaml"
    config_file.write_text("storage:\n  data_dir: ./.recallish-store\n", encoding="utf-8")

    config = load_config(config_file)
    expected = (tmp_path / ".recallish-store").resolve()
    assert Path(config.storage.data_dir) == expected


def test_default_config_path_resolves_package_config() -> None:
    resolved = default_config_path()
    assert resolved.is_absolute()


def test_missing_config_file_uses_home_fallback(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr("recallish.config.Path.home", lambda: tmp_path)
    missing = tmp_path / "does-not-exist.yaml"
    config = load_config(missing)
    resolved = Path(config.storage.data_dir)
    assert tmp_path / ".recallish" in resolved.parents or resolved == tmp_path / ".recallish"
    assert resolved.is_absolute()


def test_openai_environment_aliases_configure_summarizer(monkeypatch, tmp_path: Path) -> None:
    config_file = tmp_path / "recallish.yaml"
    config_file.write_text(
        "llm:\n  summarize_enabled: true\n  api_key: local\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("OPENAI_API_KEY", "free-tier-key")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://provider.example/v1")
    monkeypatch.setenv("OPENAI_MODEL", "free-model")

    config = load_config(config_file)

    assert config.llm.api_key == "free-tier-key"
    assert config.llm.base_url == "https://provider.example/v1"
    assert config.llm.model == "free-model"
