"""Page calibration, element geometry and commercial catalogue."""

from alembic import op
import sqlalchemy as sa

revision = '002'
down_revision = '001'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('pages', sa.Column('name', sa.String(length=200), nullable=True))
    op.add_column('pages', sa.Column('source_index', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('pages', sa.Column('meters_per_point', sa.Float(), nullable=True))
    op.execute('''
        UPDATE pages AS page
        SET source_index = indexed.source_index
        FROM (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY pdf_path ORDER BY number, id) - 1 AS source_index
            FROM pages
        ) AS indexed
        WHERE page.id = indexed.id
    ''')

    op.create_table(
        'suppliers',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('contact', sa.String(), nullable=False, server_default=''),
    )

    op.add_column('products', sa.Column('supplier_id', sa.Integer(), nullable=True))
    op.add_column('products', sa.Column('sku', sa.String(), nullable=False, server_default=''))
    op.add_column('products', sa.Column('unit', sa.String(), nullable=False, server_default='шт'))
    op.add_column('products', sa.Column('price', sa.Float(), nullable=False, server_default='0'))
    op.add_column('products', sa.Column('currency', sa.String(), nullable=False, server_default='RUB'))
    op.add_column('products', sa.Column('active', sa.Boolean(), nullable=False, server_default=sa.true()))
    op.create_foreign_key('fk_products_supplier', 'products', 'suppliers', ['supplier_id'], ['id'])

    op.add_column('elements', sa.Column('product_id', sa.Integer(), nullable=True))
    op.add_column(
        'elements',
        sa.Column('geometry', sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
    )
    op.create_foreign_key('fk_elements_product', 'elements', 'products', ['product_id'], ['id'])


def downgrade():
    op.drop_constraint('fk_elements_product', 'elements', type_='foreignkey')
    op.drop_column('elements', 'geometry')
    op.drop_column('elements', 'product_id')
    op.drop_constraint('fk_products_supplier', 'products', type_='foreignkey')
    for column in ('active', 'currency', 'price', 'unit', 'sku', 'supplier_id'):
        op.drop_column('products', column)
    op.drop_table('suppliers')
    for column in ('meters_per_point', 'source_index', 'name'):
        op.drop_column('pages', column)
