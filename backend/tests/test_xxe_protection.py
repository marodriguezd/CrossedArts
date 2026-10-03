import pytest
import defusedxml.ElementTree as ET


def test_xxe_entity_attack_blocked():
    """External entity injection must be blocked by defusedxml."""
    malicious_xml = """<?xml version="1.0"?>
    <!DOCTYPE foo [
        <!ENTITY xxe SYSTEM "file:///etc/passwd">
    ]>
    <root>&xxe;</root>
    """
    with pytest.raises(Exception):
        ET.fromstring(malicious_xml)


def test_xxe_billion_laughs_blocked():
    """Billion Laughs (entity expansion) attack must be blocked."""
    billion_laughs = """<?xml version="1.0"?>
    <!DOCTYPE lolz [
        <!ENTITY lol "lol">
        <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
        <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
        <!ENTITY lol4 "&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;">
    ]>
    <root>&lol4;</root>
    """
    with pytest.raises(Exception):
        ET.fromstring(billion_laughs)


def test_xxe_parameter_entity_blocked():
    """Parameter entity injection must be blocked."""
    malicious_xml = """<?xml version="1.0"?>
    <!DOCTYPE foo [
        <!ENTITY % xxe SYSTEM "file:///etc/passwd">
        %xxe;
    ]>
    <root>test</root>
    """
    with pytest.raises(Exception):
        ET.fromstring(malicious_xml)


def test_valid_xml_parses_correctly():
    """Normal, well-formed XML must parse without issues."""
    safe_xml = """<?xml version="1.0"?>
    <container>
        <metadata>
            <title>Test Book</title>
            <author>Author Name</author>
        </metadata>
        <spine>
            <item id="chapter1" href="chapter1.xhtml"/>
        </spine>
    </container>
    """
    root = ET.fromstring(safe_xml)
    assert root.find("metadata/title").text == "Test Book"
    assert root.find("metadata/author").text == "Author Name"
    assert root.find("spine/item").get("id") == "chapter1"


def test_valid_xml_opf_manifest():
    """OPF-style XML (used in EPUB) must parse correctly."""
    opf_xml = """<?xml version="1.0" encoding="UTF-8"?>
    <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
        <metadata>
            <title>Test EPUB</title>
            <language>es</language>
        </metadata>
        <manifest>
            <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
        </manifest>
        <spine>
            <itemref idref="ch1"/>
        </spine>
    </package>
    """
    root = ET.fromstring(opf_xml)
    title = root.find(".//{http://www.idpf.org/2007/opf}title")
    assert title is not None
    assert title.text == "Test EPUB"
