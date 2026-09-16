from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .database import get_db
from .models import Borrower, Loan, Tool
from .schemas import (
    LoanCreate,
    LoanResponse,
    ReturnRequest,
    ToolCreate,
    ToolResponse,
    ToolUpdate,
)

router = APIRouter()


def loan_to_response(
    loan: Loan,
    borrower: Borrower,
    tool: Tool,
) -> LoanResponse:
    return LoanResponse(
        id=loan.id,
        borrower_id=loan.borrower_id,
        tool_id=loan.tool_id,
        quantity=loan.quantity,
        borrowed_at=loan.borrowed_at,
        returned_at=loan.returned_at,
        status=loan.status,
        class_name=borrower.class_name,
        borrower_name=borrower.name,
        tool_name=tool.name,
    )


@router.get("/tools", response_model=list[ToolResponse])
def get_tools(db: Session = Depends(get_db)):
    return db.query(Tool).order_by(Tool.name).all()


@router.post("/tools", response_model=ToolResponse)
def create_tool(
    data: ToolCreate,
    db: Session = Depends(get_db),
):
    tool = Tool(
        name=data.name,
        category=data.category,
        description=data.description,
        location=data.location,
        quantity=data.quantity,
        available_quantity=data.quantity,
    )

    db.add(tool)
    db.commit()
    db.refresh(tool)

    return tool


@router.patch("/tools/{tool_id}", response_model=ToolResponse)
def update_tool(
    tool_id: int,
    data: ToolUpdate,
    db: Session = Depends(get_db),
):
    tool = db.query(Tool).filter(Tool.id == tool_id).first()

    if not tool:
        raise HTTPException(
            status_code=404,
            detail="工具が見つかりません",
        )

    update_data = data.model_dump(exclude_unset=True)

    if "quantity" in update_data:
        new_quantity = update_data["quantity"]

        borrowed_quantity = tool.quantity - tool.available_quantity

        if new_quantity < borrowed_quantity:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"現在貸出中の数量が{borrowed_quantity}個あるため、"
                    f"在庫数を{borrowed_quantity}個未満にはできません"
                ),
            )

        tool.quantity = new_quantity
        tool.available_quantity = new_quantity - borrowed_quantity

        update_data.pop("quantity")

    for key, value in update_data.items():
        setattr(tool, key, value)

    db.commit()
    db.refresh(tool)

    return tool


@router.delete("/tools/{tool_id}")
def delete_tool(
    tool_id: int,
    db: Session = Depends(get_db),
):
    tool = db.query(Tool).filter(Tool.id == tool_id).first()

    if not tool:
        raise HTTPException(
            status_code=404,
            detail="工具が見つかりません",
        )

    active_loan = (
        db.query(Loan)
        .filter(
            Loan.tool_id == tool_id,
            Loan.status == "borrowed",
        )
        .first()
    )

    if active_loan:
        raise HTTPException(
            status_code=400,
            detail="現在貸出中の工具は削除できません",
        )

    db.delete(tool)
    db.commit()

    return {
        "message": "工具を削除しました",
    }


@router.post("/loans", response_model=LoanResponse)
def create_loan(
    data: LoanCreate,
    db: Session = Depends(get_db),
):
    tool = db.query(Tool).filter(Tool.id == data.tool_id).first()

    if not tool:
        raise HTTPException(
            status_code=404,
            detail="工具が見つかりません",
        )

    if data.quantity > tool.available_quantity:
        raise HTTPException(
            status_code=400,
            detail=(
                f"貸出可能数が不足しています。"
                f"現在の貸出可能数: {tool.available_quantity}"
            ),
        )

    borrower = (
        db.query(Borrower)
        .filter(
            Borrower.class_name == data.class_name,
            Borrower.name == data.name,
        )
        .first()
    )

    if not borrower:
        borrower = Borrower(
            class_name=data.class_name,
            name=data.name,
        )
        db.add(borrower)
        db.flush()

    loan = Loan(
        borrower_id=borrower.id,
        tool_id=tool.id,
        quantity=data.quantity,
        status="borrowed",
    )

    tool.available_quantity -= data.quantity

    db.add(loan)
    db.commit()
    db.refresh(loan)

    return loan_to_response(loan, borrower, tool)


@router.get("/loans/current", response_model=list[LoanResponse])
def get_current_loans(
    class_name: Optional[str] = Query(default=None),
    name: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
):
    query = (
        db.query(Loan, Borrower, Tool)
        .join(Borrower, Loan.borrower_id == Borrower.id)
        .join(Tool, Loan.tool_id == Tool.id)
        .filter(Loan.status == "borrowed")
    )

    if class_name:
        query = query.filter(Borrower.class_name == class_name)

    if name:
        query = query.filter(Borrower.name == name)

    rows = query.order_by(Loan.borrowed_at.desc()).all()

    return [
        loan_to_response(loan, borrower, tool)
        for loan, borrower, tool in rows
    ]


@router.post("/loans/return", response_model=LoanResponse)
def return_loan(
    data: ReturnRequest,
    db: Session = Depends(get_db),
):
    loan = (
        db.query(Loan)
        .filter(
            Loan.id == data.loan_id,
            Loan.status == "borrowed",
        )
        .first()
    )

    if not loan:
        raise HTTPException(
            status_code=404,
            detail="貸出中の記録が見つかりません",
        )

    tool = db.query(Tool).filter(Tool.id == loan.tool_id).first()
    borrower = (
        db.query(Borrower)
        .filter(Borrower.id == loan.borrower_id)
        .first()
    )

    if not tool or not borrower:
        raise HTTPException(
            status_code=500,
            detail="貸出データが壊れています",
        )

    loan.status = "returned"
    loan.returned_at = datetime.now()

    tool.available_quantity += loan.quantity

    db.commit()
    db.refresh(loan)

    return loan_to_response(loan, borrower, tool)
