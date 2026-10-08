"""Initial schema, frozen at revision 001."""
from alembic import op
import sqlalchemy as sa
revision = '001'
down_revision = None
branch_labels = None
depends_on = None

def upgrade():
    op.create_table('element_types',
        sa.Column('id', sa.Integer(), nullable=False, primary_key=True),
        sa.Column('name', sa.String(length=200), nullable=False, primary_key=False),
        sa.Column('category', sa.String(), nullable=False, primary_key=False),
        sa.Column('unit', sa.String(), nullable=False, primary_key=False),
        sa.Column('color', sa.String(), nullable=False, primary_key=False),
        sa.Column('defaults', sa.JSON(), nullable=False, primary_key=False),
        sa.Column('wet_min_ip', sa.Integer(), nullable=True, primary_key=False),
    )
    op.create_table('manufacturers',
        sa.Column('id', sa.Integer(), nullable=False, primary_key=True),
        sa.Column('name', sa.String(), nullable=False, primary_key=False),
    )
    op.create_table('projects',
        sa.Column('id', sa.Integer(), nullable=False, primary_key=True),
        sa.Column('name', sa.String(length=200), nullable=False, primary_key=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, primary_key=False),
    )
    op.create_table('users',
        sa.Column('id', sa.Integer(), nullable=False, primary_key=True),
        sa.Column('name', sa.String(length=200), nullable=False, primary_key=False),
    )
    op.create_table('layers',
        sa.Column('id', sa.Integer(), nullable=False, primary_key=True),
        sa.Column('project_id', sa.Integer(), sa.ForeignKey('projects.id'), nullable=False, primary_key=False),
        sa.Column('name', sa.String(length=200), nullable=False, primary_key=False),
        sa.Column('visible', sa.Boolean(), nullable=False, primary_key=False),
        sa.Column('locked', sa.Boolean(), nullable=False, primary_key=False),
        sa.Column('export', sa.Boolean(), nullable=False, primary_key=False),
    )
    op.create_table('pages',
        sa.Column('id', sa.Integer(), nullable=False, primary_key=True),
        sa.Column('project_id', sa.Integer(), sa.ForeignKey('projects.id'), nullable=False, primary_key=False),
        sa.Column('number', sa.Integer(), nullable=False, primary_key=False),
        sa.Column('width', sa.Float(), nullable=False, primary_key=False),
        sa.Column('height', sa.Float(), nullable=False, primary_key=False),
        sa.Column('pdf_path', sa.String(), nullable=False, primary_key=False),
        sa.Column('image_path', sa.String(), nullable=False, primary_key=False),
    )
    op.create_table('products',
        sa.Column('id', sa.Integer(), nullable=False, primary_key=True),
        sa.Column('manufacturer_id', sa.Integer(), sa.ForeignKey('manufacturers.id'), nullable=False, primary_key=False),
        sa.Column('type_id', sa.Integer(), sa.ForeignKey('element_types.id'), nullable=False, primary_key=False),
        sa.Column('name', sa.String(), nullable=False, primary_key=False),
        sa.Column('parameters', sa.JSON(), nullable=False, primary_key=False),
    )
    op.create_table('reports',
        sa.Column('id', sa.Integer(), nullable=False, primary_key=True),
        sa.Column('project_id', sa.Integer(), sa.ForeignKey('projects.id'), nullable=False, primary_key=False),
        sa.Column('format', sa.String(), nullable=False, primary_key=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, primary_key=False),
    )
    op.create_table('rooms',
        sa.Column('id', sa.Integer(), nullable=False, primary_key=True),
        sa.Column('project_id', sa.Integer(), sa.ForeignKey('projects.id'), nullable=False, primary_key=False),
        sa.Column('name', sa.String(length=200), nullable=False, primary_key=False),
        sa.Column('wet', sa.Boolean(), nullable=False, primary_key=False),
    )
    op.create_table('elements',
        sa.Column('id', sa.Integer(), nullable=False, primary_key=True),
        sa.Column('project_id', sa.Integer(), sa.ForeignKey('projects.id'), nullable=False, primary_key=False),
        sa.Column('page_id', sa.Integer(), sa.ForeignKey('pages.id'), nullable=False, primary_key=False),
        sa.Column('layer_id', sa.Integer(), sa.ForeignKey('layers.id'), nullable=False, primary_key=False),
        sa.Column('type_id', sa.Integer(), sa.ForeignKey('element_types.id'), nullable=False, primary_key=False),
        sa.Column('room_id', sa.Integer(), sa.ForeignKey('rooms.id'), nullable=True, primary_key=False),
        sa.Column('x', sa.Float(), nullable=False, primary_key=False),
        sa.Column('y', sa.Float(), nullable=False, primary_key=False),
        sa.Column('parameters', sa.JSON(), nullable=False, primary_key=False),
        sa.Column('comment', sa.String(), nullable=False, primary_key=False),
    )

def downgrade():
    op.drop_table('elements')
    op.drop_table('rooms')
    op.drop_table('reports')
    op.drop_table('products')
    op.drop_table('pages')
    op.drop_table('layers')
    op.drop_table('users')
    op.drop_table('projects')
    op.drop_table('manufacturers')
    op.drop_table('element_types')
