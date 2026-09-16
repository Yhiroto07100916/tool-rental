interface Env {
  DB: D1Database
}

interface Tool {
  id: number
  name: string
  category: string | null
  description: string | null
  location: string | null
  quantity: number
  available_quantity: number
  created_at: string
  updated_at: string
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}

function getToolPayload(body: any) {
  const name = typeof body.name === 'string' ? body.name.trim() : ''

  if (!name) {
    throw new Error('工具名を入力してください')
  }

  const quantity = body.quantity === undefined ? 1 : Number(body.quantity)

  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new Error('数量は0以上の整数で指定してください')
  }

  return {
    name,
    category: body.category ?? null,
    description: body.description ?? null,
    location: body.location ?? null,
    quantity,
  }
}

async function getTool(
  db: D1Database,
  toolId: number,
): Promise<Tool | null> {
  return await db
    .prepare('SELECT * FROM tools WHERE id = ?')
    .bind(toolId)
    .first<Tool>()
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url)

      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          },
        })
      }


      if (url.pathname === '/health' && request.method === 'GET') {
        return json({
          status: 'ok',
        })
      }

      if (url.pathname === '/tools' && request.method === 'GET') {
        const result = await env.DB
          .prepare('SELECT * FROM tools ORDER BY id')
          .all<Tool>()

        return json(result.results)
      }

      if (url.pathname === '/tools' && request.method === 'POST') {
        const body = await request.json()
        const payload = getToolPayload(body)

        const result = await env.DB
          .prepare(`
            INSERT INTO tools (
              name,
              category,
              description,
              location,
              quantity,
              available_quantity
            )
            VALUES (?, ?, ?, ?, ?, ?)
          `)
          .bind(
            payload.name,
            payload.category,
            payload.description,
            payload.location,
            payload.quantity,
            payload.quantity,
          )
          .run()

        const tool = await getTool(env.DB, result.meta.last_row_id)

        return json(tool, 201)
      }

      const toolItemsMatch = url.pathname.match(/^\/tools\/(\d+)\/items$/)

      if (toolItemsMatch && request.method === 'GET') {
        const toolId = Number(toolItemsMatch[1])

        if (!Number.isInteger(toolId) || toolId <= 0) {
          return json(
            {
              detail: '工具IDが正しくありません',
            },
            400,
          )
        }

        const tool = await getTool(env.DB, toolId)

        if (!tool) {
          return json(
            {
              detail: '工具が見つかりません',
            },
            404,
          )
        }

        const result = await env.DB
          .prepare(`
            SELECT
              id,
              tool_id,
              management_number,
              status,
              created_at,
              updated_at
            FROM tool_items
            WHERE tool_id = ?
            ORDER BY management_number ASC
          `)
          .bind(toolId)
          .all()

        return json(result.results)
      }

      if (url.pathname === '/loans' && request.method === 'POST') {
        const body = await request.json()

        const className =
          typeof body.class_name === 'string'
            ? body.class_name.trim()
            : ''

        const borrowerName =
          typeof body.name === 'string'
            ? body.name.trim()
            : ''

        const toolId = Number(body.tool_id)

        const rawToolItemIds = Array.isArray(body.tool_item_ids)
          ? body.tool_item_ids
          : []

        const toolItemIds = rawToolItemIds.map(Number)

        if (!className) {
          return json(
            {
              detail: 'クラスを入力してください',
            },
            400,
          )
        }

        if (!borrowerName) {
          return json(
            {
              detail: '氏名を入力してください',
            },
            400,
          )
        }

        if (!Number.isInteger(toolId) || toolId <= 0) {
          return json(
            {
              detail: '工具IDを指定してください',
            },
            400,
          )
        }

        if (
          toolItemIds.length === 0 ||
          toolItemIds.some(
            (id: number) => !Number.isInteger(id) || id <= 0,
          )
        ) {
          return json(
            {
              detail: '貸し出す工具個体を1つ以上選択してください',
            },
            400,
          )
        }

        const uniqueToolItemIds = [...new Set(toolItemIds)]

        if (uniqueToolItemIds.length !== toolItemIds.length) {
          return json(
            {
              detail: '同じ工具個体を重複して選択することはできません',
            },
            400,
          )
        }

        const quantity = uniqueToolItemIds.length

        const tool = await getTool(env.DB, toolId)

        if (!tool) {
          return json(
            {
              detail: '工具が見つかりません',
            },
            404,
          )
        }

        if (tool.available_quantity < quantity) {
          return json(
            {
              detail: `在庫が不足しています。現在貸出可能なのは${tool.available_quantity}個です`,
            },
            400,
          )
        }

        const placeholders = uniqueToolItemIds
          .map(() => '?')
          .join(', ')

        const toolItemsResult = await env.DB
          .prepare(`
            SELECT
              id,
              tool_id,
              management_number,
              status
            FROM tool_items
            WHERE id IN (${placeholders})
              AND tool_id = ?
          `)
          .bind(...uniqueToolItemIds, toolId)
          .all<{
            id: number
            tool_id: number
            management_number: string
            status: string
          }>()

        const toolItems = toolItemsResult.results

        if (toolItems.length !== uniqueToolItemIds.length) {
          return json(
            {
              detail: '指定された工具個体の一部が見つかりません',
            },
            404,
          )
        }

        const unavailableItem = toolItems.find(
          item => item.status !== 'available',
        )

        if (unavailableItem) {
          return json(
            {
              detail: `工具個体 ${unavailableItem.management_number} は現在貸出できません`,
            },
            400,
          )
        }

        let borrower = await env.DB
          .prepare(`
            SELECT
              id,
              class_name,
              name
            FROM borrowers
            WHERE class_name = ?
              AND name = ?
            LIMIT 1
          `)
          .bind(className, borrowerName)
          .first<{
            id: number
            class_name: string
            name: string
          }>()

        if (!borrower) {
          const borrowerResult = await env.DB
            .prepare(`
              INSERT INTO borrowers (
                class_name,
                name
              )
              VALUES (?, ?)
            `)
            .bind(className, borrowerName)
            .run()

          const borrowerId = Number(borrowerResult.meta.last_row_id)

          if (!borrowerId) {
            return json(
              {
                detail: '借用者の登録に失敗しました',
              },
              500,
            )
          }

          borrower = {
            id: borrowerId,
            class_name: className,
            name: borrowerName,
          }
        }

        const loanResult = await env.DB
          .prepare(`
            INSERT INTO loans (
              borrower_id,
              tool_id,
              quantity,
              returned_quantity,
              status
            )
            VALUES (?, ?, ?, 0, 'borrowed')
          `)
          .bind(
            borrower.id,
            toolId,
            quantity,
          )
          .run()

        const loanId = Number(loanResult.meta.last_row_id)

        if (!loanId) {
          return json(
            {
              detail: '貸出記録の登録に失敗しました',
            },
            500,
          )
        }

        const statements: D1PreparedStatement[] = []

        statements.push(
          env.DB
            .prepare(`
              UPDATE tools
              SET
                available_quantity = available_quantity - ?,
                updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
                AND available_quantity >= ?
            `)
            .bind(quantity, toolId, quantity),
        )

        for (const toolItemId of uniqueToolItemIds) {
          statements.push(
            env.DB
              .prepare(`
                UPDATE tool_items
                SET
                  status = 'borrowed',
                  updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                  AND tool_id = ?
                  AND status = 'available'
              `)
              .bind(toolItemId, toolId),
          )

          statements.push(
            env.DB
              .prepare(`
                INSERT INTO loan_items (
                  loan_id,
                  tool_item_id
                )
                VALUES (?, ?)
              `)
              .bind(loanId, toolItemId),
          )
        }

        await env.DB.batch(statements)

        const latestLoan = await env.DB
          .prepare(`
            SELECT
              loans.id,
              loans.borrower_id,
              loans.tool_id,
              loans.quantity,
              loans.returned_quantity,
              loans.borrowed_at,
              loans.returned_at,
              loans.returned_by_id,
              loans.status,
              borrowers.class_name,
              borrowers.name AS borrower_name,
              tools.name AS tool_name
            FROM loans
            INNER JOIN borrowers
              ON borrowers.id = loans.borrower_id
            INNER JOIN tools
              ON tools.id = loans.tool_id
            WHERE loans.id = ?
          `)
          .bind(loanId)
          .first()

        const loanToolItems = await env.DB
          .prepare(`
            SELECT
              tool_items.id,
              tool_items.tool_id,
              tool_items.management_number,
              tool_items.status,
              loan_items.id AS loan_item_id,
              loan_items.returned_at
            FROM loan_items
            INNER JOIN tool_items
              ON tool_items.id = loan_items.tool_item_id
            WHERE loan_items.loan_id = ?
            ORDER BY tool_items.management_number ASC
          `)
          .bind(loanId)
          .all()

        return json(
          {
            ...latestLoan,
            tool_items: loanToolItems.results,
          },
          201,
        )
      }

if (url.pathname === '/loans/current' && request.method === 'GET') {
  const className = url.searchParams.get('class_name')?.trim()
  const borrowerName = url.searchParams.get('name')?.trim()

  let query = [
    'SELECT',
    '  loans.id,',
    '  loans.borrower_id,',
    '  loans.tool_id,',
    '  loans.quantity,',
    '  loans.borrowed_at,',
    '  loans.returned_at,',
    '  loans.returned_by_id,',
    '  loans.status,',
    '  borrowers.class_name,',
    '  borrowers.name AS borrower_name,',
    '  tools.name AS tool_name',
    'FROM loans',
    'INNER JOIN borrowers ON borrowers.id = loans.borrower_id',
    'INNER JOIN tools ON tools.id = loans.tool_id',
    "WHERE loans.status = 'borrowed'",
  ].join(' ')

  const bindings: string[] = []

  if (className) {
    query += ' AND borrowers.class_name = ?'
    bindings.push(className)
  }

  if (borrowerName) {
    query += ' AND borrowers.name = ?'
    bindings.push(borrowerName)
  }

  query += ' ORDER BY loans.borrowed_at DESC'

  const result = await env.DB
    .prepare(query)
    .bind(...bindings)
    .all()

  return json(result.results)
}

if (url.pathname === '/loans/history' && request.method === 'GET') {
          const className = url.searchParams.get('class_name')?.trim()

          let query = `
            SELECT
              loans.id,
              loans.borrower_id,
              loans.tool_id,
              loans.quantity,
              loans.borrowed_at,
              loans.returned_at,
              loans.returned_by_id,
              loans.status,
              borrowers.class_name,
              borrowers.name AS borrower_name,
              returned_borrowers.class_name AS returned_by_class_name,
              returned_borrowers.name AS returned_by_name,
              tools.name AS tool_name
            FROM loans
            INNER JOIN borrowers
              ON borrowers.id = loans.borrower_id
            INNER JOIN tools
              ON tools.id = loans.tool_id
            LEFT JOIN borrowers AS returned_borrowers
              ON returned_borrowers.id = loans.returned_by_id
          `

          const bindings: string[] = []

          if (className) {
            query += ' WHERE borrowers.class_name = ?'
            bindings.push(className)
          }

          query += ' ORDER BY loans.borrowed_at DESC'

          const result = await env.DB
            .prepare(query)
            .bind(...bindings)
            .all()

          return json(result.results)
        }

        if (url.pathname === '/loans/return' && request.method === 'POST') {
          const body = await request.json()

          const rawLoanIds = Array.isArray(body.loan_ids)
            ? body.loan_ids
            : body.loan_id !== undefined
              ? [body.loan_id]
              : []

          const loanIds = rawLoanIds.map(Number)

          if (
            loanIds.length === 0 ||
            loanIds.some(
              (id: number) => !Number.isInteger(id) || id <= 0,
            )
          ) {
            return json(
              {
                detail: '返却する貸出IDを指定してください',
              },
              400,
            )
          }

          const uniqueLoanIds = [...new Set(loanIds)]

          const returnerClassName =
            typeof body.class_name === 'string'
              ? body.class_name.trim()
              : ''

          const returnerName =
            typeof body.name === 'string'
              ? body.name.trim()
              : ''

          if (!returnerClassName) {
            return json(
              {
                detail: '返却者のクラスを入力してください',
              },
              400,
            )
          }

          if (!returnerName) {
            return json(
              {
                detail: '返却者の氏名を入力してください',
              },
              400,
            )
          }

          const placeholders = uniqueLoanIds
            .map(() => '?')
            .join(', ')

          const loansResult = await env.DB
            .prepare(`
              SELECT
                loans.id,
                loans.tool_id,
                loans.quantity,
                loans.status
              FROM loans
              WHERE loans.id IN (${placeholders})
            `)
            .bind(...uniqueLoanIds)
            .all<{
              id: number
              tool_id: number
              quantity: number
              status: string
            }>()

          const loans = loansResult.results

          if (loans.length !== uniqueLoanIds.length) {
            return json(
              {
                detail: '指定された貸出記録の一部が見つかりません',
              },
              404,
            )
          }

          const alreadyReturned = loans.find(
            loan => loan.status !== 'borrowed',
          )

          if (alreadyReturned) {
            return json(
              {
                detail: `貸出ID ${alreadyReturned.id} はすでに返却されています`,
              },
              400,
            )
          }

          // 返却者を取得。存在しなければ登録する。
          const existingReturner = await env.DB
            .prepare(`
              SELECT id
              FROM borrowers
              WHERE class_name = ?
                AND name = ?
              LIMIT 1
            `)
            .bind(returnerClassName, returnerName)
            .first<{ id: number }>()

          let returnerId = existingReturner?.id ?? null

          if (returnerId === null) {
            const inserted = await env.DB
              .prepare(`
                INSERT INTO borrowers (
                  class_name,
                  name
                )
                VALUES (?, ?)
              `)
              .bind(returnerClassName, returnerName)
              .run()

            returnerId = Number(inserted.meta.last_row_id)

            if (!returnerId) {
              return json(
                {
                  detail: '返却者の登録に失敗しました',
                },
                500,
              )
            }
          }

          // 全貸出の返却処理と在庫更新を1回のbatchで実行する。
          const returnStatements: D1PreparedStatement[] = []

          for (const loan of loans) {
            returnStatements.push(
              env.DB
                .prepare(`
                  UPDATE loans
                  SET
                    status = 'returned',
                    returned_at = CURRENT_TIMESTAMP,
                    returned_by_id = ?
                  WHERE id = ?
                    AND status = 'borrowed'
                `)
                .bind(returnerId, loan.id),
            )

            returnStatements.push(
              env.DB
                .prepare(`
                  UPDATE tools
                  SET
                    available_quantity = available_quantity + ?,
                    updated_at = CURRENT_TIMESTAMP
                  WHERE id = ?
                `)
                .bind(loan.quantity, loan.tool_id),
            )
          }

          await env.DB.batch(returnStatements)

          const returnedLoansResult = await env.DB
            .prepare(`
              SELECT
                loans.id,
                loans.borrower_id,
                loans.tool_id,
                loans.quantity,
                loans.borrowed_at,
                loans.returned_at,
                loans.returned_by_id,
                loans.status,
                borrowers.class_name,
                borrowers.name AS borrower_name,
                returned_borrowers.class_name AS returned_by_class_name,
                returned_borrowers.name AS returned_by_name,
                tools.name AS tool_name
              FROM loans
              INNER JOIN borrowers
                ON borrowers.id = loans.borrower_id
              INNER JOIN tools
                ON tools.id = loans.tool_id
              LEFT JOIN borrowers AS returned_borrowers
                ON returned_borrowers.id = loans.returned_by_id
              WHERE loans.id IN (${placeholders})
              ORDER BY loans.id
            `)
            .bind(...uniqueLoanIds)
            .all()

          return json({
            count: returnedLoansResult.results.length,
            loans: returnedLoansResult.results,
          })
        }

      const toolMatch = url.pathname.match(/^\/tools\/(\d+)$/)

      if (toolMatch) {
        const toolId = Number(toolMatch[1])
        const existingTool = await getTool(env.DB, toolId)

        if (!existingTool) {
          return json(
            {
              detail: '工具が見つかりません',
            },
            404,
          )
        }

        if (request.method === 'PATCH') {
          const body = await request.json()

          const name =
            body.name === undefined
              ? existingTool.name
              : typeof body.name === 'string'
                ? body.name.trim()
                : ''

          if (!name) {
            return json(
              {
                detail: '工具名を入力してください',
              },
              400,
            )
          }

          const quantity =
            body.quantity === undefined
              ? existingTool.quantity
              : Number(body.quantity)

          if (!Number.isInteger(quantity) || quantity < 0) {
            return json(
              {
                detail: '数量は0以上の整数で指定してください',
              },
              400,
            )
          }

          const borrowedQuantity =
            existingTool.quantity - existingTool.available_quantity

          if (quantity < borrowedQuantity) {
            return json(
              {
                detail: `現在${borrowedQuantity}個貸出中のため、数量を${borrowedQuantity}個未満にはできません`,
              },
              400,
            )
          }

          const availableQuantity = quantity - borrowedQuantity

          await env.DB
            .prepare(`
              UPDATE tools
              SET
                name = ?,
                category = ?,
                description = ?,
                location = ?,
                quantity = ?,
                available_quantity = ?,
                updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
            `)
            .bind(
              name,
              body.category === undefined
                ? existingTool.category
                : body.category,
              body.description === undefined
                ? existingTool.description
                : body.description,
              body.location === undefined
                ? existingTool.location
                : body.location,
              quantity,
              availableQuantity,
              toolId,
            )
            .run()

          return json(await getTool(env.DB, toolId))
        }

        if (request.method === 'DELETE') {
          const borrowedQuantity =
            existingTool.quantity - existingTool.available_quantity

          if (borrowedQuantity > 0) {
            return json(
              {
                detail: '貸出中の工具は削除できません',
              },
              400,
            )
          }

          await env.DB
            .prepare('DELETE FROM tools WHERE id = ?')
            .bind(toolId)
            .run()

          return new Response(null, {
            status: 204,
          })
        }
      }

      return json(
        {
          detail: 'Not Found',
        },
        404,
      )
    } catch (error) {
      console.error(error)

      if (error instanceof SyntaxError) {
        return json(
          {
            detail: 'JSONの形式が正しくありません',
          },
          400,
        )
      }

      if (error instanceof Error) {
        return json(
          {
            detail: error.message,
          },
          400,
        )
      }

      return json(
        {
          detail: 'Internal Server Error',
        },
        500,
      )
    }
  },
}
