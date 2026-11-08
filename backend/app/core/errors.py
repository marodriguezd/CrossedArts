"""Domain failures that carry the HTTP answer they deserve.

An error code is part of the error, not something the router guesses from the
message. A blanket ``except ValueError`` used to answer ``RESOURCE_NOT_FOUND``
for a missing lesson and ``NOTE_NOT_FOUND`` (404) for a content the parser could
not read: the client was told a different story from the one that happened.

Services raise a subclass of ``DomainError`` with its own ``code`` and
``http_status``; the router only forwards them through ``get_http_exception``.
Subclassing ``ValueError`` keeps every existing ``except ValueError`` caller
working, and a failure that is NOT a ``DomainError`` keeps propagating as a 500
instead of being dressed as "not found".
"""


class DomainError(ValueError):
    """Base class for a failure with a stable public code and status."""

    code = "DOMAIN_ERROR"
    http_status = 422
