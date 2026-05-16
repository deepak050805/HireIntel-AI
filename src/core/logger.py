import json
import logging
from logging import StreamHandler, Formatter


class JSONFormatter(Formatter):
    def format(self, record):
        data = {
            'timestamp': self.formatTime(record, self.datefmt),
            'logger': record.name,
            'level': record.levelname,
            'message': record.getMessage()
        }
        return json.dumps(data)


def get_logger(name=__name__, level=logging.INFO):
    logger = logging.getLogger(name)
    if not logger.handlers:
        handler = StreamHandler()
        handler.setFormatter(JSONFormatter())
        logger.addHandler(handler)
    logger.setLevel(level)
    return logger
