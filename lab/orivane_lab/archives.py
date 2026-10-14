"""Seek a multi-part ZIP without assembling or extracting a duplicate archive."""
from __future__ import annotations

import bisect
import io
import json
import zipfile
from pathlib import Path

from .download import CORPUS_BYTES
from .storage import read_json


class ConcatenatedReader(io.RawIOBase):
    def __init__(self, paths):
        self.paths = [Path(p) for p in paths]
        self.offsets = [0]
        for path in self.paths:
            self.offsets.append(self.offsets[-1] + path.stat().st_size)
        self.position = 0
        self._handle = None
        self._index = -1

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.position

    def seek(self, offset, whence=io.SEEK_SET):
        if self.closed:
            raise ValueError("Seek on closed multipart source")
        position = offset if whence == io.SEEK_SET else self.position + offset if whence == io.SEEK_CUR else self.offsets[-1] + offset
        if position < 0:
            raise ValueError("Negative seek")
        self.position = position
        return position

    def read(self, size=-1):
        if self.closed:
            raise ValueError("Read on closed multipart source")
        if size is None or size < 0:
            size = self.offsets[-1] - self.position
        size = min(size, max(0, self.offsets[-1] - self.position))
        chunks = []
        while size:
            index = bisect.bisect_right(self.offsets, self.position) - 1
            available = min(size, self.offsets[index + 1] - self.position)
            if index != self._index:
                if self._handle is not None:
                    self._handle.close()
                self._handle = self.paths[index].open("rb")
                self._index = index
            self._handle.seek(self.position - self.offsets[index])
            chunk = self._handle.read(available)
            if len(chunk) != available:
                raise EOFError("Multipart ZIP changed while reading")
            chunks.append(chunk)
            size -= available
            self.position += available
        return b"".join(chunks)

    def readinto(self, buffer):
        data = self.read(len(buffer))
        buffer[:len(data)] = data
        return len(data)

    def close(self):
        if self._handle is not None:
            self._handle.close()
        super().close()


class OwnedZipFile(zipfile.ZipFile):
    def close(self):
        super().close()
        reader = getattr(self, "_orivane_reader", None)
        if reader is not None:
            reader.close()


def open_corpus(root: Path):
    status = read_json(Path(root) / "registry/kraken-corpus.json")
    if not status or status.get("status") != "verified" or status.get("downloadedBytes") != CORPUS_BYTES:
        raise ValueError("Only a complete SHA256-verified corpus can be used")
    paths = [Path(root) / "raw/kraken" / f"Kraken_Trades_Full.zip.part{i:02d}" for i in range(14)]
    reader = ConcatenatedReader(paths)
    archive = OwnedZipFile(reader)
    archive._orivane_reader = reader
    return archive


def inspect_corpus(root: Path):
    with open_corpus(root) as archive:
        members = [{"name": row.filename, "compressedBytes": row.compress_size, "uncompressedBytes": row.file_size,
            "crc32": f"{row.CRC:08x}"} for row in archive.infolist()]
        names = [row["name"] for row in members if Path(row["name"]).name == "MANIFEST.json"]
        if len(names) != 1:
            raise ValueError("Expected one official MANIFEST.json")
        if archive.getinfo(names[0]).file_size > 10_000_000:
            raise ValueError("Unexpected manifest size")
        manifest = json.loads(archive.read(names[0]))
        return {"members": members, "manifest": manifest, "compressedBytes": sum(row["compressedBytes"] for row in members),
            "uncompressedBytes": sum(row["uncompressedBytes"] for row in members)}
