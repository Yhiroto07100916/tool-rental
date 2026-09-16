from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.sql import func

from .database import Base


class Tool(Base):
    __tablename__ = "tools"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    category = Column(String(100), nullable=True)
    description = Column(Text, nullable=True)
    location = Column(String(200), nullable=True)
    quantity = Column(Integer, nullable=False, default=1)
    available_quantity = Column(Integer, nullable=False, default=1)

    created_at = Column(
        DateTime,
        nullable=False,
        server_default=func.now(),
    )

    updated_at = Column(
        DateTime,
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class Borrower(Base):
    __tablename__ = "borrowers"

    id = Column(Integer, primary_key=True, index=True)
    class_name = Column(String(50), nullable=False)
    name = Column(String(100), nullable=False)

    created_at = Column(
        DateTime,
        nullable=False,
        server_default=func.now(),
    )

    updated_at = Column(
        DateTime,
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


class Loan(Base):
    __tablename__ = "loans"

    id = Column(Integer, primary_key=True, index=True)

    borrower_id = Column(
        Integer,
        ForeignKey("borrowers.id"),
        nullable=False,
    )

    tool_id = Column(
        Integer,
        ForeignKey("tools.id"),
        nullable=False,
    )

    quantity = Column(
        Integer,
        nullable=False,
        default=1,
    )

    borrowed_at = Column(
        DateTime,
        nullable=False,
        server_default=func.now(),
    )

    returned_at = Column(
        DateTime,
        nullable=True,
    )

    status = Column(
        String(20),
        nullable=False,
        default="borrowed",
    )
